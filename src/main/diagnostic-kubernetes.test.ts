import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:https";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTlsFixture } from "../../test/tls-fixture";
import { CredentialPluginError } from "./context-identity";
import { DiagnosticKubernetes, type DiagnosticObject } from "./diagnostic-kubernetes";

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
        response.writeHead(201).end(JSON.stringify(object));
        return;
      }
      const value = objects.get(request.url ?? "");
      if (!value) response.writeHead(404).end();
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
    await expect(
      api.createGenerated("ServerStatusRequest", "fixture", "status-", new AbortController().signal),
    ).rejects.toMatchObject({ code: "forbidden" });
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

    await expect(api.read("DownloadRequest", "fixture", "absent", signal)).rejects.toMatchObject({ code: "forbidden" });
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
