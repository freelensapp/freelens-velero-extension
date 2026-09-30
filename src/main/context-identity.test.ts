import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ContextEntry, connectionOf, type Runner, readContext, runCredentialPlugin } from "./context-identity";

let directory: string;
let file: string;

function configuration(changes: Record<string, unknown> = {}) {
  return {
    apiVersion: "v1",
    kind: "Config",
    "current-context": "other",
    contexts: [
      { name: "fixture", context: { cluster: "fixture", user: "fixture" } },
      { name: "other", context: { cluster: "other", user: "other" } },
      { name: "plugin", context: { cluster: "fixture", user: "plugin" } },
      { name: "no-user", context: { cluster: "fixture" } },
      { name: "no-cluster", context: { cluster: "absent", user: "fixture" } },
    ],
    clusters: [
      { name: "fixture", cluster: { server: "https://127.0.0.1:6443", "certificate-authority-data": "Q0E=" } },
      { name: "other", cluster: { server: "https://127.0.0.2:6443", "certificate-authority-data": "Q0E=" } },
    ],
    users: [
      { name: "fixture", user: { token: "synthetic-token" } },
      { name: "other", user: { token: "other-token" } },
      {
        name: "plugin",
        user: { exec: { apiVersion: "client.authentication.k8s.io/v1", command: "plugin", args: ["a"] } },
      },
    ],
    ...changes,
  };
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "velero-context-"));
  file = join(directory, "kubeconfig");
  await writeFile(file, JSON.stringify(configuration()), { mode: 0o600 });
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("the entry of a context", () => {
  it("reads the entry of the context that is named, whatever the current one is", async () => {
    const read = readContext(file, "fixture");

    expect("entry" in read).toBe(true);
    if (!("entry" in read)) return;
    expect(read.entry.cluster.server).toBe("https://127.0.0.1:6443");
    expect(read.entry.user.token).toBe("synthetic-token");
    expect(read.connection).toEqual({ supported: true, credential: "token" });
    expect(read.configuration.getCurrentContext()).toBe("fixture");
  });

  it("says what is missing: the file, the context, its cluster, its user", async () => {
    expect(readContext(join(directory, "absent"), "fixture")).toEqual({ missing: "file" });
    expect(readContext(file, "unknown")).toEqual({ missing: "context" });
    expect(readContext(file, "no-cluster")).toEqual({ missing: "cluster" });
    expect(readContext(file, "no-user")).toEqual({ missing: "user" });
  });

  it("changes its digest with the entry of the context and not with another context of the file", async () => {
    const before = readContext(file, "fixture");
    const other = join(directory, "other");

    await writeFile(
      other,
      JSON.stringify(
        configuration({
          users: [
            ...configuration().users.slice(0, 1),
            { name: "other", user: { token: "rotated" } },
            configuration().users[2],
          ],
        }),
      ),
    );
    const otherChanged = readContext(other, "fixture");
    const rotated = join(directory, "rotated");

    await writeFile(
      rotated,
      JSON.stringify(
        configuration({ users: [{ name: "fixture", user: { token: "rotated" } }, ...configuration().users.slice(1)] }),
      ),
    );
    const entryChanged = readContext(rotated, "fixture");

    expect("digest" in before && "digest" in otherChanged && before.digest === otherChanged.digest).toBe(true);
    expect("digest" in before && "digest" in entryChanged && before.digest !== entryChanged.digest).toBe(true);
  });

  it("names the connection the adapter takes and the one it refuses", () => {
    const entry = (
      user: Partial<ContextEntry["user"]>,
      cluster: Partial<ContextEntry["cluster"]> = {},
    ): ContextEntry => ({
      context: "c",
      cluster: { name: "c", server: "https://127.0.0.1:6443", ...cluster },
      user: { name: "u", ...user },
    });

    expect(connectionOf(entry({ token: "t" }))).toEqual({ supported: true, credential: "token" });
    expect(connectionOf(entry({ certData: "c", keyData: "k" }))).toEqual({
      supported: true,
      credential: "certificate",
    });
    expect(connectionOf(entry({ certFile: "/c", keyFile: "/k" }))).toEqual({
      supported: true,
      credential: "certificate",
    });
    expect(connectionOf(entry({ exec: { command: "plugin" } }))).toEqual({ supported: true, credential: "plugin" });
    expect(connectionOf(entry({ authProvider: { name: "oidc" } }))).toEqual({
      supported: false,
      reason: "auth-provider",
    });
    expect(connectionOf(entry({ username: "u", password: "p" }))).toEqual({ supported: false, reason: "basic" });
    expect(connectionOf(entry({ token: "t" }, { proxyUrl: "http://proxy.invalid" }))).toEqual({
      supported: false,
      reason: "proxy",
    });
    expect(connectionOf(entry({ token: "t" }, { skipTLSVerify: true }))).toEqual({
      supported: false,
      reason: "insecure-tls",
    });
    expect(connectionOf(entry({}))).toEqual({ supported: false, reason: "no-credential" });
    expect(connectionOf(entry({ certData: "c" }))).toEqual({ supported: false, reason: "no-credential" });
  });
});

describe("the plugin of a context", () => {
  const entry: ContextEntry = {
    context: "plugin",
    cluster: { name: "fixture", server: "https://127.0.0.1:6443", caData: "Q0E=" },
    user: {
      name: "plugin",
      exec: {
        command: "plugin",
        args: ["a", "b"],
        env: [{ name: "PLUGIN_PROFILE", value: "synthetic" }],
        provideClusterInfo: true,
      },
    },
  };
  const credential = (status: Record<string, unknown>) =>
    JSON.stringify({ apiVersion: "client.authentication.k8s.io/v1", kind: "ExecCredential", status });

  it("runs the command with its arguments and its environment, and reads the token it gives", async () => {
    let seen: { command: string; args: string[]; env: NodeJS.ProcessEnv; timeout: number } | undefined;
    const run: Runner = (command, args, options, callback) => {
      seen = { command, args, env: options.env, timeout: options.timeout };
      callback(null, credential({ token: "plugin-token", expirationTimestamp: "2030-01-01T00:00:00Z" }), "");
    };
    const result = await runCredentialPlugin(entry, { run, environment: { HOME: "/synthetic" }, timeoutMs: 1234 });

    expect(result).toEqual({ token: "plugin-token", expires: Date.parse("2030-01-01T00:00:00Z") });
    expect(seen?.command).toBe("plugin");
    expect(seen?.args).toEqual(["a", "b"]);
    expect(seen?.env.HOME).toBe("/synthetic");
    expect(seen?.env.PLUGIN_PROFILE).toBe("synthetic");
    expect(JSON.parse(seen?.env.KUBERNETES_EXEC_INFO ?? "{}")).toMatchObject({
      kind: "ExecCredential",
      spec: { interactive: false, cluster: { server: "https://127.0.0.1:6443" } },
    });
    expect(seen?.timeout).toBe(1234);
  });

  it("reads a certificate with its key", async () => {
    const run: Runner = (_c, _a, _o, callback) =>
      callback(null, credential({ clientCertificateData: "CERT", clientKeyData: "KEY" }), "");

    await expect(runCredentialPlugin(entry, { run })).resolves.toEqual({ certData: "CERT", keyData: "KEY" });
  });

  it("refuses, with nothing of the output, a plugin that fails, one that gives no credential and one whose output is not one", async () => {
    const failing: Runner = (_c, _a, _o, callback) =>
      callback(new Error("PRIVATE-SENTINEL"), "PRIVATE-SENTINEL", "PRIVATE-SENTINEL");
    const empty: Runner = (_c, _a, _o, callback) => callback(null, credential({}), "");
    const text: Runner = (_c, _a, _o, callback) => callback(null, "PRIVATE-SENTINEL not json", "");
    const wrongKind: Runner = (_c, _a, _o, callback) =>
      callback(null, JSON.stringify({ kind: "Secret", status: { token: "PRIVATE-SENTINEL" } }), "");

    for (const run of [failing, empty, text, wrongKind]) {
      const error = await runCredentialPlugin(entry, { run }).catch((caught: unknown) => caught);

      expect(error).toMatchObject({ code: "forbidden" });
      expect(JSON.stringify(error)).not.toContain("PRIVATE-SENTINEL");
      expect(String(error)).not.toContain("PRIVATE-SENTINEL");
    }
  });

  it("refuses a context that names no plugin", async () => {
    await expect(runCredentialPlugin({ ...entry, user: { name: "u", token: "t" } })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("runs a real command within its bound, and refuses one that does not end in time", async () => {
    const script = join(directory, "plugin.mjs");

    await writeFile(
      script,
      `const wait = Number(process.argv[2] ?? 0); setTimeout(() => { process.stdout.write(JSON.stringify({ apiVersion: "client.authentication.k8s.io/v1", kind: "ExecCredential", status: { token: "real-token" } })); }, wait);`,
    );
    const quick: ContextEntry = {
      ...entry,
      user: { name: "p", exec: { command: process.execPath, args: [script, "0"] } },
    };
    const slow: ContextEntry = {
      ...entry,
      user: { name: "p", exec: { command: process.execPath, args: [script, "5000"] } },
    };

    await expect(runCredentialPlugin(quick)).resolves.toEqual({ token: "real-token" });
    await expect(runCredentialPlugin(slow, { timeoutMs: 300 })).rejects.toMatchObject({ code: "forbidden" });
  });
});
