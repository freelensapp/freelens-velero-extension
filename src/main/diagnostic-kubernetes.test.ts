import { generateKeyPairSync, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:https";
import { type AddressInfo, createServer as createListener, type Socket } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { inspect } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTlsFixture } from "../../test/tls-fixture";
import { CredentialPluginError } from "./context-identity";
import { DiagnosticKubernetes, type DiagnosticObject } from "./diagnostic-kubernetes";
import { DiagnosticError } from "./diagnostic-transport";
import type { TLSSocket } from "node:tls";

let certificates: Awaited<ReturnType<typeof createTlsFixture>>;
let server: Server;
let path: string;
let configuration: Record<string, unknown>;
let current = true;
const requests: { method?: string; path?: string; body?: unknown; impersonate?: string; client?: string }[] = [];
const objects = new Map<string, DiagnosticObject>();
const binding = () => ({ clusterId: "synthetic-cluster", context: "fixture-context", kubeconfigPath: path });

beforeAll(async () => {
  certificates = await createTlsFixture();
  // A client certificate is asked and not required: the requests that present one say whose it is.
  server = createServer(
    { ...certificates, requestCert: true, rejectUnauthorized: false },
    async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;

      const impersonate = request.headers["impersonate-user"];
      const client = (request.socket as import("node:tls").TLSSocket).getPeerCertificate?.()?.subject?.CN;

      requests.push({
        method: request.method,
        path: request.url,
        body,
        ...(typeof impersonate === "string" ? { impersonate } : {}),
        ...(typeof client === "string" ? { client } : {}),
      });
      if (request.headers.authorization === "Bearer expired-token") {
        response.writeHead(401).end();
        return;
      }
      if (request.headers.authorization !== "Bearer synthetic-token") {
        response.writeHead(403).end();
        return;
      }
      if (request.url?.endsWith("/pending")) return;
      // The endpoint slices of a Service, as the API lists them for the label that names it.
      if (request.url?.startsWith("/apis/discovery.k8s.io/v1/namespaces/fixture/endpointslices")) {
        const selector = new URL(request.url, "https://fixture.invalid").searchParams.get("labelSelector");
        const slice = (name: string, namespace: string, service: string) => ({
          metadata: { name, namespace, uid: `${name}-uid`, labels: { "kubernetes.io/service-name": service } },
          addressType: "IPv4",
          ports: [{ name: "s3", port: 8333, protocol: "TCP" }],
          endpoints: [
            { addresses: ["10.244.0.7"], conditions: { ready: true }, targetRef: { kind: "Pod", name: "storage-0" } },
          ],
        });

        if (selector === "kubernetes.io/service-name=refused") {
          response.writeHead(403).end();
          return;
        }
        response.end(
          JSON.stringify({
            kind: "EndpointSliceList",
            apiVersion: "discovery.k8s.io/v1",
            metadata: { resourceVersion: "7" },
            items:
              selector === "kubernetes.io/service-name=storage"
                ? [slice("storage-abcde", "fixture", "storage"), slice("storage-fghij", "fixture", "storage")]
                : selector === "kubernetes.io/service-name=elsewhere"
                  ? [slice("elsewhere-abcde", "another", "elsewhere")]
                  : selector === "kubernetes.io/service-name=mislabelled"
                    ? [slice("mislabelled-abcde", "fixture", "another")]
                    : selector === "kubernetes.io/service-name=shapeless"
                      ? "not-a-list"
                      : [],
          }),
        );
        return;
      }
      if (request.url?.endsWith("/secrets/denied")) {
        response.writeHead(403).end();
        return;
      }
      if (request.url?.endsWith("/secrets/certificate")) {
        response.end(
          JSON.stringify({
            metadata: { name: "certificate", namespace: "fixture", uid: "ca-uid" },
            data: { "ca.crt": Buffer.from(certificates.ca).toString("base64"), credentials: "SYNTHETIC-DO-NOT-RETURN" },
          }),
        );
        return;
      }
      if (request.method === "POST") {
        const name = body.metadata.name ?? `${body.metadata.generateName}generated`;
        const key = `${request.url}/${name}`;

        if (objects.has(key)) {
          response.writeHead(409).end();
          return;
        }
        const object = { ...body, metadata: { ...body.metadata, name, uid: randomUUID() } };

        objects.set(key, object);
        if (name === "ambiguous") {
          response.destroy();
          return;
        }
        if (name === "invalid-response") {
          response.writeHead(201).end("not-json");
          return;
        }
        if (name === "unanswered") return;
        if (name === "failing") {
          response.writeHead(500).end();
          return;
        }
        // An answer beyond what the adapter reads of an object.
        if (name === "oversized") {
          response.writeHead(201).end(JSON.stringify({ ...object, padding: "x".repeat(4 * 1024 ** 2) }));
          return;
        }
        response.writeHead(201).end(JSON.stringify(object));
        return;
      }
      const value = objects.get(request.url ?? "");
      if (!value) response.writeHead(404).end();
      else if (request.url?.endsWith("/oversized"))
        response.end(JSON.stringify({ ...(value as object), padding: "x".repeat(4 * 1024 ** 2) }));
      else response.end(JSON.stringify(value));
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  if (!address || typeof address === "string") throw new Error("Missing API fixture listener");
  path = join(certificates.directory, "kubeconfig.json");
  configuration = {
    apiVersion: "v1",
    kind: "Config",
    "current-context": "not-selected",
    contexts: [{ name: "fixture-context", context: { cluster: "fixture", user: "fixture" } }],
    clusters: [
      {
        name: "fixture",
        cluster: {
          server: `https://127.0.0.1:${address.port}`,
          "certificate-authority-data": Buffer.from(certificates.ca).toString("base64"),
        },
      },
    ],
    users: [{ name: "fixture", user: { token: "synthetic-token" } }],
  };
});
beforeEach(async () => {
  requests.length = 0;
  objects.clear();
  current = true;
  await writeFile(path, JSON.stringify(configuration), { mode: 0o600 });
});
afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await certificates?.dispose();
});

describe("explicit create-only Kubernetes adapter", () => {
  it("has a way to read and a way to create, and none to change or to remove an object", () => {
    // What the adapter can do, by name: a method added to it is looked at here, against the rule that the
    // extension deletes no request.
    expect(Object.getOwnPropertyNames(DiagnosticKubernetes.prototype).sort()).toEqual([
      "assertCurrent",
      "authenticate",
      "authenticatedConfiguration",
      "certificate",
      "constructor",
      "createDownload",
      "createGenerated",
      "credentialOfPlugin",
      "dispose",
      "list",
      "path",
      "read",
      "send",
      "withCredential",
    ]);
  });

  it("uses the selected context and POST, preserves generated names and refuses collisions", async () => {
    const api = new DiagnosticKubernetes(binding(), () => current);
    const signal = new AbortController().signal;
    const created = await api.createDownload("fixture", "BackupLog", "backup", "download", randomUUID(), signal);

    expect(created.metadata.name).toBe("download");
    await expect(
      api.createDownload("fixture", "BackupLog", "backup", "download", randomUUID(), signal),
    ).rejects.toMatchObject({ code: "conflict" });
    const generated = await api.createGenerated("ServerStatusRequest", "fixture", "status-", signal);

    expect(generated.metadata.name).toBe("status-generated");
    expect(requests.every((item) => item.method === "POST")).toBe(true);
    expect(requests[2].body).toMatchObject({ metadata: { generateName: "status-" }, spec: {} });
  });

  it("rejects missing contexts and changed selections before network access", async () => {
    expect(() => new DiagnosticKubernetes({ ...binding(), context: "absent" }, () => true)).toThrow("validation");
    const api = new DiagnosticKubernetes(binding(), () => current);

    current = false;
    await expect(api.read("Backup", "fixture", "backup", new AbortController().signal)).rejects.toMatchObject({
      code: "target-changed",
    });
    expect(requests).toEqual([]);
  });

  it("rejects a change of the entry of the context before network access, and not one of another context", async () => {
    const api = new DiagnosticKubernetes(binding(), () => true);
    const users = configuration.users as { name: string; user: Record<string, string> }[];

    // A byte of the file, and another context of it: not the identity of this one.
    await writeFile(
      path,
      `${JSON.stringify({
        ...configuration,
        "current-context": "elsewhere",
        contexts: [
          ...(configuration.contexts as unknown[]),
          { name: "elsewhere", context: { cluster: "fixture", user: "elsewhere" } },
        ],
        users: [...users, { name: "elsewhere", user: { token: "rotated-elsewhere" } }],
      })}\n`,
    );
    await api.read("Backup", "fixture", "backup", new AbortController().signal).catch(() => undefined);
    expect(requests).toHaveLength(1);
    // The credential of this context: the identity.
    await writeFile(
      path,
      JSON.stringify({ ...configuration, users: [{ name: "fixture", user: { token: "rotated-here" } }] }),
    );
    await expect(api.read("Backup", "fixture", "backup", new AbortController().signal)).rejects.toMatchObject({
      code: "target-changed",
    });
    expect(requests).toHaveLength(1);
  });

  it("runs the plugin of a context for its credential, within its bound, and refuses what it cannot read", async () => {
    const script = join(certificates.directory, "plugin.mjs");
    const plugin = (token: string, wait = 0) => ({
      ...configuration,
      users: [
        {
          name: "fixture",
          user: {
            exec: {
              apiVersion: "client.authentication.k8s.io/v1",
              command: process.execPath,
              args: [script, token, String(wait)],
              env: [{ name: "PLUGIN_PROFILE", value: "synthetic" }],
            },
          },
        },
      ],
    });

    await writeFile(
      script,
      `const [token, wait] = process.argv.slice(2); if (process.env.PLUGIN_PROFILE !== "synthetic") process.exit(3); setTimeout(() => process.stdout.write(JSON.stringify({ apiVersion: "client.authentication.k8s.io/v1", kind: "ExecCredential", status: { token } })), Number(wait));`,
    );
    await writeFile(path, JSON.stringify(plugin("synthetic-token")));
    const api = new DiagnosticKubernetes(binding(), () => true);
    const read = await api
      .read("DownloadRequest", "fixture", "absent", new AbortController().signal)
      .catch((error: unknown) => error);

    // The plugin gave the token the fixture accepts: the request reached the server and was answered.
    expect(read).toMatchObject({ code: "not-found" });
    expect(requests).toHaveLength(1);
    await writeFile(path, JSON.stringify(plugin("wrong-token")));
    const wrong = new DiagnosticKubernetes(binding(), () => true);

    await expect(
      wrong.read("DownloadRequest", "fixture", "absent", new AbortController().signal),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(requests).toHaveLength(2);
  });

  it("says that the plugin failed, by its command, and not that the cluster refused", async () => {
    await writeFile(
      path,
      JSON.stringify({
        ...configuration,
        users: [{ name: "fixture", user: { exec: { command: join(certificates.directory, "absent-plugin") } } }],
      }),
    );
    const api = new DiagnosticKubernetes(binding(), () => true);
    const error = await api
      .createGenerated("ServerStatusRequest", "fixture", "status-", new AbortController().signal)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CredentialPluginError);
    expect(error).toMatchObject({ code: "request-failed", command: "absent-plugin", reason: "failed" });
    expect(requests).toEqual([]);
  });

  it("writes as the user the context impersonates, with a token and with a plugin", async () => {
    const script = join(certificates.directory, "impersonating-plugin.mjs");

    await writeFile(
      script,
      `process.stdout.write(JSON.stringify({ apiVersion: "client.authentication.k8s.io/v1", kind: "ExecCredential", status: { token: "synthetic-token" } }));`,
    );
    for (const user of [
      { token: "synthetic-token", as: "impersonated" },
      { exec: { command: process.execPath, args: [script] }, as: "impersonated" },
    ]) {
      requests.length = 0;
      await writeFile(path, JSON.stringify({ ...configuration, users: [{ name: "fixture", user }] }));
      const api = new DiagnosticKubernetes(binding(), () => true);

      await api.createGenerated("ServerStatusRequest", "fixture", "status-", new AbortController().signal);
      expect(requests).toHaveLength(1);
      expect(requests[0].impersonate).toBe("impersonated");
      objects.clear();
    }
  });

  it("refuses a context that impersonates groups, a uid or extra fields, which the client cannot send", async () => {
    for (const field of [{ "as-groups": ["group"] }, { "as-uid": "1" }, { "as-user-extra": { scope: ["a"] } }]) {
      await writeFile(
        path,
        JSON.stringify({
          ...configuration,
          users: [{ name: "fixture", user: { token: "synthetic-token", as: "impersonated", ...field } }],
        }),
      );
      expect(() => new DiagnosticKubernetes(binding(), () => true)).toThrow("validation");
    }
    expect(requests).toEqual([]);
  });

  it("presents the certificate a plugin gives, which is PEM and not base64", async () => {
    const script = join(certificates.directory, "certificate-plugin.mjs");

    await writeFile(
      script,
      `import { readFileSync } from "node:fs"; const [cert, key] = process.argv.slice(2).map((file) => readFileSync(file, "utf8")); process.stdout.write(JSON.stringify({ apiVersion: "client.authentication.k8s.io/v1", kind: "ExecCredential", status: { clientCertificateData: cert, clientKeyData: key } }));`,
    );
    await writeFile(join(certificates.directory, "client.crt"), certificates.cert);
    await writeFile(join(certificates.directory, "client.key"), certificates.key, { mode: 0o600 });
    await writeFile(
      path,
      JSON.stringify({
        ...configuration,
        users: [
          {
            name: "fixture",
            user: {
              exec: {
                command: process.execPath,
                args: [script, join(certificates.directory, "client.crt"), join(certificates.directory, "client.key")],
              },
            },
          },
        ],
      }),
    );
    const api = new DiagnosticKubernetes(binding(), () => true);

    // The fixture answers 403 to a request without its token: the request went out with the certificate.
    // A refusal of a permission says nothing of the credential.
    const refused = await api
      .createGenerated("ServerStatusRequest", "fixture", "status-", new AbortController().signal)
      .catch((error: unknown) => error);

    expect(refused).toMatchObject({ code: "forbidden" });
    expect((refused as DiagnosticError).verdict).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(requests[0].client).toBe("storage.example.invalid");
  });

  // A plugin that gives the token of a file, with no expiration, after a wait; it counts its runs.
  async function countingPlugin(token: string, wait = 0) {
    const script = join(certificates.directory, "counting-plugin.mjs");
    const tokenFile = join(certificates.directory, "counting.token");
    const runsFile = join(certificates.directory, "counting.runs");

    await writeFile(
      script,
      `import { appendFileSync, readFileSync } from "node:fs"; const [tokenFile, runsFile, wait] = process.argv.slice(2); appendFileSync(runsFile, "run\\n"); setTimeout(() => process.stdout.write(JSON.stringify({ apiVersion: "client.authentication.k8s.io/v1", kind: "ExecCredential", status: { token: readFileSync(tokenFile, "utf8") } })), Number(wait));`,
    );
    await writeFile(tokenFile, token);
    await writeFile(runsFile, "");
    await writeFile(
      path,
      JSON.stringify({
        ...configuration,
        users: [
          {
            name: "fixture",
            user: { exec: { command: process.execPath, args: [script, tokenFile, runsFile, String(wait)] } },
          },
        ],
      }),
    );
    return {
      rotate: (next: string) => writeFile(tokenFile, next),
      runs: async () => (await readFile(runsFile, "utf8")).split("\n").filter(Boolean).length,
    };
  }

  it("asks the plugin again after a 401, for a credential that says no expiration", async () => {
    const plugin = await countingPlugin("expired-token");
    const api = new DiagnosticKubernetes(binding(), () => true);
    const signal = new AbortController().signal;

    // A credential the cluster does not take is told from a permission the identity lacks.
    const turned = await api.read("DownloadRequest", "fixture", "absent", signal).catch((error: unknown) => error);

    expect(turned).toMatchObject({ code: "forbidden", verdict: "credential" });
    await plugin.rotate("synthetic-token");
    await expect(api.read("DownloadRequest", "fixture", "absent", signal)).rejects.toMatchObject({ code: "not-found" });
    expect(await plugin.runs()).toBe(2);
    // A credential the cluster takes is kept: the plugin is not run for every request.
    await expect(api.read("DownloadRequest", "fixture", "absent", signal)).rejects.toMatchObject({ code: "not-found" });
    expect(await plugin.runs()).toBe(2);
  });

  it("runs the plugin once for requests that wait for it together", async () => {
    const plugin = await countingPlugin("synthetic-token", 300);
    const api = new DiagnosticKubernetes(binding(), () => true);
    const signal = new AbortController().signal;
    const results = await Promise.all(
      [1, 2, 3].map(() => api.read("DownloadRequest", "fixture", "absent", signal).catch((error: unknown) => error)),
    );

    expect(results).toEqual([1, 2, 3].map(() => expect.objectContaining({ code: "not-found" })));
    expect(await plugin.runs()).toBe(1);
  });

  it("cancels one of the requests that wait for the plugin together, and not the others", async () => {
    const plugin = await countingPlugin("synthetic-token", 600);
    const api = new DiagnosticKubernetes(binding(), () => true);
    const controller = new AbortController();
    const cancelled = api
      .read("DownloadRequest", "fixture", "absent", controller.signal)
      .catch((error: unknown) => error);
    const kept = api
      .read("DownloadRequest", "fixture", "absent", new AbortController().signal)
      .catch((error: unknown) => error);

    await delay(200);
    controller.abort();
    expect(await cancelled).toMatchObject({ code: "cancelled" });
    expect(await kept).toMatchObject({ code: "not-found" });
    expect(await plugin.runs()).toBe(1);
  });

  it("cancels a write that waits for its plugin, and kills the plugin", async () => {
    const script = join(certificates.directory, "slow-plugin.mjs");
    const pidFile = join(certificates.directory, "slow-plugin.pid");

    await writeFile(
      script,
      `import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], String(process.pid)); setTimeout(() => process.stdout.write(JSON.stringify({ apiVersion: "client.authentication.k8s.io/v1", kind: "ExecCredential", status: { token: "synthetic-token" } })), 2500);`,
    );
    await writeFile(
      path,
      JSON.stringify({
        ...configuration,
        users: [{ name: "fixture", user: { exec: { command: process.execPath, args: [script, pidFile] } } }],
      }),
    );
    const api = new DiagnosticKubernetes(binding(), () => true);
    const controller = new AbortController();
    const started = Date.now();
    const pending = api
      .createGenerated("ServerStatusRequest", "fixture", "status-", controller.signal)
      .catch((error: unknown) => error);

    await delay(400);
    controller.abort();
    expect(await pending).toMatchObject({ code: "cancelled" });
    expect(Date.now() - started).toBeLessThan(2000);
    const child = Number(await readFile(pidFile, "utf8"));
    let alive = true;

    for (let tries = 0; alive && tries < 80; tries += 1) {
      try {
        process.kill(child, 0);
        await delay(25);
      } catch {
        alive = false;
      }
    }
    expect(alive).toBe(false);
    await delay(2500);
    expect(requests).toEqual([]);
  }, 10_000);

  it("does not retry an ambiguous POST and permits an explicit read to reconcile", async () => {
    const api = new DiagnosticKubernetes(binding(), () => true);

    await expect(
      api.createDownload("fixture", "BackupLog", "backup", "ambiguous", randomUUID(), new AbortController().signal),
    ).rejects.toMatchObject({ code: "submission-unknown" });
    const found = await api.read("DownloadRequest", "fixture", "ambiguous", new AbortController().signal);

    expect(found.metadata.name).toBe("ambiguous");
    expect(requests.filter((item) => item.method === "POST")).toHaveLength(1);
  });

  it("classifies an unreadable create response as ambiguous and refuses cross-namespace responses", async () => {
    const api = new DiagnosticKubernetes(binding(), () => true);
    const signal = new AbortController().signal;

    await expect(
      api.createDownload("fixture", "BackupLog", "backup", "invalid-response", randomUUID(), signal),
    ).rejects.toMatchObject({ code: "submission-unknown" });
    expect(requests.filter((item) => item.method === "POST")).toHaveLength(1);
    objects.set("/apis/velero.io/v1/namespaces/fixture/backups/backup", {
      metadata: { name: "backup", namespace: "other", uid: "unexpected" },
    });
    await expect(api.read("Backup", "fixture", "backup", signal)).rejects.toMatchObject({ code: "target-changed" });
  });

  // The kubeconfig of the fixture with other fields for its cluster: another address, or no authority.
  const withCluster = (change: (cluster: Record<string, string>) => Record<string, string>) => {
    const [fixture] = configuration.clusters as { name: string; cluster: Record<string, string> }[];

    return writeFile(
      path,
      JSON.stringify({ ...configuration, clusters: [{ name: fixture.name, cluster: change(fixture.cluster) }] }),
    );
  };

  it("says that a creation refused before the connection was not sent, and not that it may have happened", async () => {
    const signal = new AbortController().signal;
    const listener = createListener();

    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const { port } = listener.address() as AddressInfo;

    await new Promise<void>((resolve) => listener.close(() => resolve()));
    const refused: unknown[] = [];

    // Nothing listens on the port, then nothing vouches for the certificate of the server: neither is a
    // connection this side writes on, and the fixture receives no request.
    for (const change of [
      (cluster: Record<string, string>) => ({ ...cluster, server: `https://127.0.0.1:${port}` }),
      (cluster: Record<string, string>) => ({ server: cluster.server }),
    ]) {
      await withCluster(change);
      const api = new DiagnosticKubernetes(binding(), () => true);

      refused.push(
        await api.createGenerated("ServerStatusRequest", "fixture", "status-", signal).catch((error: unknown) => error),
      );
    }
    expect(refused).toMatchObject([{ code: "transport-unreachable" }, { code: "transport-unreachable" }]);
    await delay(100);
    expect(requests).toEqual([]);
  });

  it("says that a creation still without its connection at the bound was not sent", async () => {
    // A listener that takes the connection and never answers the handshake.
    const taken: Socket[] = [];
    const silent = createListener((socket) => taken.push(socket));

    silent.listen(0, "127.0.0.1");
    await once(silent, "listening");
    await withCluster((cluster) => ({
      ...cluster,
      server: `https://127.0.0.1:${(silent.address() as AddressInfo).port}`,
    }));
    const api = new DiagnosticKubernetes(binding(), () => true);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const connection = once(silent, "connection");
      const pending = api
        .createGenerated("ServerStatusRequest", "fixture", "status-", new AbortController().signal)
        .catch((error: unknown) => error);

      await connection;
      vi.advanceTimersByTime(10_000);
      expect(await pending).toMatchObject({ code: "deadline" });
    } finally {
      vi.useRealTimers();
      for (const socket of taken) socket.destroy();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });

  it("keeps as unknown a creation the server received and failed, or did not answer within the bound", async () => {
    const api = new DiagnosticKubernetes(binding(), () => true);
    const signal = new AbortController().signal;

    await expect(
      api.createDownload("fixture", "BackupLog", "backup", "failing", randomUUID(), signal),
    ).rejects.toMatchObject({ code: "submission-unknown" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = api
        .createDownload("fixture", "BackupLog", "backup", "unanswered", randomUUID(), signal)
        .catch((error: unknown) => error);

      // The fixture has read the whole request, and keeps its answer.
      for (let tries = 0; requests.length < 2 && tries < 400; tries += 1) await delay(5);
      expect(requests.map((item) => item.method)).toEqual(["POST", "POST"]);
      vi.advanceTimersByTime(10_000);
      expect(await pending).toMatchObject({ code: "submission-unknown" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates a request for one of the eight artifacts, and sends nothing for any other target", async () => {
    const api = new DiagnosticKubernetes(binding(), () => true);
    const signal = new AbortController().signal;

    for (const target of ["BackupContents", "BackupItemOperations", "backuplog", ""])
      expect(() =>
        api.createDownload("fixture", target as never, "backup", `refused-${randomUUID()}`, randomUUID(), signal),
      ).toThrow("validation");
    // An identifier that is not one is refused the same way.
    expect(() => api.createDownload("fixture", "BackupLog", "backup", "refused", "not-an-identifier", signal)).toThrow(
      "validation",
    );
    await delay(50);
    expect(requests).toEqual([]);
    api.dispose();
  });

  it("keeps as unknown a creation whose answer is larger than it reads, and says of a read that it is too large", async () => {
    const api = new DiagnosticKubernetes(binding(), () => true);
    const signal = new AbortController().signal;

    // The object was created: its answer cannot be read, which says nothing of the creation.
    await expect(
      api.createDownload("fixture", "BackupLog", "backup", "oversized", randomUUID(), signal),
    ).rejects.toMatchObject({ code: "submission-unknown" });
    await expect(api.read("DownloadRequest", "fixture", "oversized", signal)).rejects.toMatchObject({
      code: "payload-too-large",
    });
    expect(requests.map((item) => item.method)).toEqual(["POST", "GET"]);
    api.dispose();
  });

  it("reaches an API server at an IPv6 address, and names no server to it unless the kubeconfig does", async () => {
    // The fixture again, at the loopback address of IPv6; it notes the server name each connection indicates.
    const indicated: unknown[] = [];
    const listener = createServer(
      { ...certificates, requestCert: true, rejectUnauthorized: false },
      (request, response) => server.emit("request", request, response),
    );

    listener.on("secureConnection", (socket) => indicated.push(socket.servername));
    listener.listen(0, "::1");
    await once(listener, "listening");
    const address = `https://[::1]:${(listener.address() as AddressInfo).port}`;
    const names: Record<string, string>[] = [{}, { "tls-server-name": "api.example.invalid" }];

    try {
      for (const named of names) {
        await withCluster((cluster) => ({ ...cluster, ...named, server: address }));
        const api = new DiagnosticKubernetes(binding(), () => true);
        const created = await api.createGenerated(
          "ServerStatusRequest",
          "fixture",
          "status-",
          new AbortController().signal,
        );

        expect(created.metadata.name).toBe("status-generated");
        objects.clear();
        api.dispose();
      }
      expect(requests).toHaveLength(2);
      // An address is not a name: none is indicated for it, and the certificate is checked by the address.
      expect(indicated).toEqual([false, "api.example.invalid"]);
    } finally {
      listener.closeAllConnections();
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    }
  });

  it("labels the deletion of a backup with its name, cut as Velero cuts it beyond 63 characters", async () => {
    const api = new DiagnosticKubernetes(binding(), () => true);
    const signal = new AbortController().signal;
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

    for (const [backup] of cases) {
      await api.createGenerated("DeleteBackupRequest", "fixture", "delete-", signal, {
        name: backup,
        uid: "backup-uid",
      });
      objects.clear();
    }
    api.dispose();
    // The request names the backup whole: only the label is cut.
    expect(requests.map((item) => item.body)).toMatchObject(
      cases.map(([backup, label]) => ({
        metadata: { labels: { "velero.io/backup-name": label, "velero.io/backup-uid": "backup-uid" } },
        spec: { backupName: backup },
      })),
    );
  });

  // The connections the fixture takes while it is watched, in the order it takes them.
  const connections = () => {
    const taken: TLSSocket[] = [];
    const take = (socket: TLSSocket) => taken.push(socket);

    server.on("secureConnection", take);
    return { taken, stop: () => server.off("secureConnection", take) };
  };
  const closed = (socket: TLSSocket) =>
    socket.destroyed ? Promise.resolve() : new Promise<void>((resolve) => socket.once("close", () => resolve()));

  it("sends a creation and the reads that follow it on one connection, which it keeps", async () => {
    const api = new DiagnosticKubernetes(binding(), () => true);
    const signal = new AbortController().signal;
    const watched = connections();

    try {
      const created = await api.createGenerated("ServerStatusRequest", "fixture", "status-", signal);

      for (let turn = 0; turn < 3; turn += 1)
        await api.read("ServerStatusRequest", "fixture", created.metadata.name, signal);
      expect(requests.map((item) => item.method)).toEqual(["POST", "GET", "GET", "GET"]);
      expect(watched.taken).toHaveLength(1);
    } finally {
      watched.stop();
      api.dispose();
    }
  });

  it("closes the connections it keeps, and the ones of the requests in flight, when it is disposed", async () => {
    const api = new DiagnosticKubernetes(binding(), () => true);
    const signal = new AbortController().signal;
    const watched = connections();

    try {
      await api.read("Secret", "fixture", "certificate", signal);
      // Two reads the fixture does not answer: one on the connection that was kept, one on another.
      const flying = [1, 2].map(() =>
        api.read("DownloadRequest", "fixture", "pending", signal).catch((error: unknown) => error),
      );

      for (let tries = 0; requests.length < 3 && tries < 400; tries += 1) await delay(5);
      await api.read("Secret", "fixture", "certificate", signal);
      expect(watched.taken).toHaveLength(3);
      expect(watched.taken.map((socket) => socket.destroyed)).toEqual([false, false, false]);
      api.dispose();
      // Well before the two seconds after which a connection nothing uses is closed by itself.
      const left = await Promise.race([
        Promise.all(watched.taken.map(closed)).then(() => "closed"),
        delay(1000, "kept"),
      ]);

      expect(left).toBe("closed");
      expect(await Promise.all(flying)).toMatchObject([
        { code: "transport-unreachable" },
        { code: "transport-unreachable" },
      ]);
    } finally {
      watched.stop();
    }
  });

  it("closes a connection that no request used for two seconds", async () => {
    const api = new DiagnosticKubernetes(binding(), () => true);
    const signal = new AbortController().signal;
    const watched = connections();

    try {
      await api.read("Secret", "fixture", "certificate", signal);
      await api.read("Secret", "fixture", "certificate", signal);
      expect(watched.taken).toHaveLength(1);
      const freed = Date.now();

      await closed(watched.taken[0]);
      // By this side, at its bound: the fixture closes a connection nothing uses after five seconds.
      expect(Date.now() - freed).toBeGreaterThanOrEqual(1900);
      expect(Date.now() - freed).toBeLessThan(4000);
    } finally {
      watched.stop();
      api.dispose();
    }
  });

  it("keeps as unknown a creation written on a connection it kept, when the answer is lost", async () => {
    const api = new DiagnosticKubernetes(binding(), () => true);
    const signal = new AbortController().signal;
    const watched = connections();

    try {
      await api.read("Secret", "fixture", "certificate", signal);
      await expect(
        api.createDownload("fixture", "BackupLog", "backup", "ambiguous", randomUUID(), signal),
      ).rejects.toMatchObject({ code: "submission-unknown" });
      // The creation went on the connection of the read: no handshake came between the two.
      expect(watched.taken).toHaveLength(1);
      expect(requests.map((item) => item.method)).toEqual(["GET", "POST"]);
    } finally {
      watched.stop();
      api.dispose();
    }
  });

  it("takes away the connection of a request that was cancelled or reached its bound", async () => {
    const api = new DiagnosticKubernetes(binding(), () => true);
    const signal = new AbortController().signal;
    const watched = connections();

    try {
      await api.read("Secret", "fixture", "certificate", signal);
      const controller = new AbortController();
      const cancelled = api
        .read("DownloadRequest", "fixture", "pending", controller.signal)
        .catch((error: unknown) => error);

      for (let tries = 0; requests.length < 2 && tries < 400; tries += 1) await delay(5);
      controller.abort();
      expect(await cancelled).toMatchObject({ code: "cancelled" });
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const late = api.read("DownloadRequest", "fixture", "pending", signal).catch((error: unknown) => error);

        for (let tries = 0; requests.length < 3 && tries < 400; tries += 1) await delay(5);
        vi.advanceTimersByTime(10_000);
        expect(await late).toMatchObject({ code: "deadline" });
      } finally {
        vi.useRealTimers();
      }
      // The cancelled read went on the connection that was kept, the late one on a new one: both are
      // closed by this side, and what is asked next is answered, on a third.
      expect(watched.taken).toHaveLength(2);
      await Promise.all(watched.taken.map(closed));
      const secret = await api.read("Secret", "fixture", "certificate", signal);

      expect(secret.metadata.uid).toBe("ca-uid");
      expect(watched.taken).toHaveLength(3);
    } finally {
      watched.stop();
      api.dispose();
    }
  });

  it("gives a request a connection that presented its own client certificate, or none", async () => {
    const script = join(certificates.directory, "changing-plugin.mjs");
    const kind = join(certificates.directory, "changing.kind");

    // A plugin that gives the token, with a certificate when the file says so, and a credential that has
    // expired already: it is asked again for every request.
    await writeFile(
      script,
      `import { readFileSync } from "node:fs"; const [kind, cert, key] = process.argv.slice(2); const certificate = readFileSync(kind, "utf8") === "certificate" ? { clientCertificateData: readFileSync(cert, "utf8"), clientKeyData: readFileSync(key, "utf8") } : {}; process.stdout.write(JSON.stringify({ apiVersion: "client.authentication.k8s.io/v1", kind: "ExecCredential", status: { token: "synthetic-token", expirationTimestamp: "2000-01-01T00:00:00Z", ...certificate } }));`,
    );
    await writeFile(join(certificates.directory, "client.crt"), certificates.cert);
    await writeFile(join(certificates.directory, "client.key"), certificates.key, { mode: 0o600 });
    await writeFile(
      path,
      JSON.stringify({
        ...configuration,
        users: [
          {
            name: "fixture",
            user: {
              exec: {
                command: process.execPath,
                args: [
                  script,
                  kind,
                  join(certificates.directory, "client.crt"),
                  join(certificates.directory, "client.key"),
                ],
              },
            },
          },
        ],
      }),
    );
    const api = new DiagnosticKubernetes(binding(), () => true);
    const signal = new AbortController().signal;
    const watched = connections();

    try {
      for (const given of ["certificate", "token", "certificate", "token"]) {
        await writeFile(kind, given);
        await api.read("Secret", "fixture", "certificate", signal);
      }
      // What the fixture saw of the client of each request, and how many connections carried the four.
      expect(requests.map((item) => item.client)).toEqual([
        "storage.example.invalid",
        undefined,
        "storage.example.invalid",
        undefined,
      ]);
      expect(watched.taken).toHaveLength(2);
    } finally {
      watched.stop();
      api.dispose();
    }
  });

  it("turns a request that cannot be made into a code, with nothing of the credential in it", async () => {
    const signal = new AbortController().signal;
    const data = (text: string) => Buffer.from(text).toString("base64");
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    const failures: unknown[] = [];

    // A token that ends with a new line, as the only line of a file is read, which no header takes; then a
    // certificate with a key that is not its own, which no connection takes. Node raises both at once.
    for (const user of [
      { token: "SENTINEL-OF-THE-TOKEN\n" },
      { "client-certificate-data": data(certificates.cert), "client-key-data": data(other) },
    ]) {
      await writeFile(path, JSON.stringify({ ...configuration, users: [{ name: "fixture", user }] }));
      const api = new DiagnosticKubernetes(binding(), () => true);

      failures.push(
        await api.createGenerated("ServerStatusRequest", "fixture", "status-", signal).catch((error: unknown) => error),
        await api.read("Backup", "fixture", "backup", signal).catch((error: unknown) => error),
      );
      api.dispose();
    }
    // Nothing was sent: the request is refused here, as one this side cannot write.
    expect(failures.map((failure) => failure instanceof DiagnosticError)).toEqual([true, true, true, true]);
    expect(failures).toMatchObject([1, 2, 3, 4].map(() => ({ code: "validation" })));
    expect(inspect(failures, { depth: 8, showHidden: true })).not.toMatch(/SENTINEL|PRIVATE KEY/);
    await delay(100);
    expect(requests).toEqual([]);
  });

  it("resolves only the named certificate value and does not bypass a denied Secret read", async () => {
    const api = new DiagnosticKubernetes(binding(), () => true);
    const signal = new AbortController().signal;

    expect(await api.certificate("fixture", { caCert: Buffer.from(certificates.ca).toString("base64") }, signal)).toBe(
      certificates.ca,
    );
    expect(await api.certificate("fixture", { caCertRef: { name: "certificate", key: "ca.crt" } }, signal)).toBe(
      certificates.ca,
    );
    await expect(
      api.certificate("fixture", { caCertRef: { name: "denied", key: "ca.crt" } }, signal),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("takes the certificate the location refers to when it gives one inline as well, as the release does", async () => {
    const api = new DiagnosticKubernetes(binding(), () => true);
    const signal = new AbortController().signal;
    // An inline value that is no certificate: taken, it would end as one that is not valid.
    const inline = Buffer.from("not the certificate of the store").toString("base64");

    expect(
      await api.certificate("fixture", { caCert: inline, caCertRef: { name: "certificate", key: "ca.crt" } }, signal),
    ).toBe(certificates.ca);
    expect(requests.map((item) => `${item.method} ${item.path}`)).toEqual([
      "GET /api/v1/namespaces/fixture/secrets/certificate",
    ]);
    // The reference is the one that counts: a Secret that is refused, and a key that is not in it, are not
    // made up for with the inline value.
    const valid = Buffer.from(certificates.ca).toString("base64");

    await expect(
      api.certificate("fixture", { caCert: valid, caCertRef: { name: "denied", key: "ca.crt" } }, signal),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      api.certificate("fixture", { caCert: valid, caCertRef: { name: "certificate", key: "absent.crt" } }, signal),
    ).rejects.toMatchObject({ code: "tls-invalid" });
    // Without a reference the inline value is what there is.
    await expect(api.certificate("fixture", { caCert: inline }, signal)).rejects.toMatchObject({ code: "tls-invalid" });
    api.dispose();
  });

  it("gives the client of a tunnel the configuration of the context with the credential of its plugin, and no plugin to run", async () => {
    const signal = new AbortController().signal;
    // A context without a plugin is given as it is: the client of Kubernetes has nothing to run.
    const plain = new DiagnosticKubernetes(binding(), () => true);

    expect(await plain.authenticatedConfiguration(signal)).toBe(plain.configuration);
    plain.dispose();
    // A context with a plugin: the plugin is run by the adapter, once and within its bound, and what the
    // client is given carries the token it gave and no command.
    const script = join(certificates.directory, "tunnel-plugin.mjs");
    const runs = join(certificates.directory, "tunnel-plugin.runs");

    await writeFile(runs, "");
    await writeFile(
      script,
      `import { appendFileSync } from "node:fs"; appendFileSync(process.argv[2], "x"); process.stdout.write(JSON.stringify({ apiVersion: "client.authentication.k8s.io/v1", kind: "ExecCredential", status: { token: "synthetic-token" } }));`,
    );
    await writeFile(
      path,
      JSON.stringify({
        ...configuration,
        users: [{ name: "fixture", user: { exec: { command: process.execPath, args: [script, runs] } } }],
      }),
    );
    const api = new DiagnosticKubernetes(binding(), () => true);
    const given = await api.authenticatedConfiguration(signal);
    const user = given.getCurrentUser();

    expect(given).not.toBe(api.configuration);
    expect(given.getCurrentContext()).toBe("fixture-context");
    expect(given.getCurrentCluster()?.server).toBe(api.configuration.getCluster("fixture")?.server);
    expect(user).toMatchObject({ name: "fixture", token: "synthetic-token" });
    expect(user?.exec).toBeUndefined();
    expect(user?.authProvider).toBeUndefined();
    // The credential the adapter keeps is the one it gives again: the plugin ran once for both.
    await api.read("Secret", "fixture", "certificate", signal);
    await api.authenticatedConfiguration(signal);
    expect(await readFile(runs, "utf8")).toBe("x");
    // A plugin that gives no credential is said as such, and no configuration is given.
    await writeFile(
      path,
      JSON.stringify({
        ...configuration,
        users: [{ name: "fixture", user: { exec: { command: join(certificates.directory, "absent-plugin") } } }],
      }),
    );
    const failing = new DiagnosticKubernetes(binding(), () => true);

    await expect(failing.authenticatedConfiguration(signal)).rejects.toBeInstanceOf(CredentialPluginError);
    api.dispose();
    failing.dispose();
  });

  it("lists the endpoint slices of a Service by the label that names it, and takes none that is not of it", async () => {
    const api = new DiagnosticKubernetes(binding(), () => true);
    const signal = new AbortController().signal;
    const slices = await api.list("EndpointSlice", "fixture", "storage", signal);

    expect(slices.map((slice) => slice.metadata.name)).toEqual(["storage-abcde", "storage-fghij"]);
    expect(requests).toEqual([
      expect.objectContaining({
        method: "GET",
        path: "/apis/discovery.k8s.io/v1/namespaces/fixture/endpointslices?labelSelector=kubernetes.io%2Fservice-name%3Dstorage",
      }),
    ]);
    // A Service without a slice has no endpoint; the list is asked for with GET and nothing else.
    expect(await api.list("EndpointSlice", "fixture", "empty", signal)).toEqual([]);
    // A slice of another namespace, or of another Service, and an answer that is not a list, are not taken.
    for (const service of ["elsewhere", "mislabelled", "shapeless"])
      await expect(api.list("EndpointSlice", "fixture", service, signal)).rejects.toMatchObject({
        code: "request-failed",
      });
    await expect(api.list("EndpointSlice", "fixture", "refused", signal)).rejects.toMatchObject({ code: "forbidden" });
    // No other kind is listed, and a name that is not one of a Service asks nothing.
    const asked = requests.length;

    expect(() => api.list("Secret" as never, "fixture", "storage", signal)).toThrow("validation");
    expect(() => api.list("EndpointSlice", "fixture", "storage,other=1", signal)).toThrow("validation");
    expect(() => api.list("EndpointSlice", "fixture", "a".repeat(64), signal)).toThrow("validation");
    expect(requests).toHaveLength(asked);
    expect(requests.every((item) => item.method === "GET")).toBe(true);
    api.dispose();
  });

  it("propagates cancellation to an API socket", async () => {
    const api = new DiagnosticKubernetes(binding(), () => true);
    const controller = new AbortController();
    const arrived = once(server, "request");
    const pending = api.read("DownloadRequest", "fixture", "pending", controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: "cancelled" });
    const [request] = await arrived;
    // The peer may observe the cancellation as a reset before the close.
    const closed = new Promise<void>((resolve) => request.socket.once("close", () => resolve()));

    controller.abort();
    await rejected;
    await closed;
  });
});
