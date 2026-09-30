// The identity of a cluster the main process writes to: the entry of one context of a kubeconfig, which is
// the address of the server, its certificate authority and the credential of the user, and nothing else of
// the file. A change of the entry is a change of the target; a change elsewhere in the file, of another
// context, is not. The file is read again at every step of a write, and compared by its digest.
//
// A context that authenticates with a plugin is run here, as the client of Kubernetes runs it for the
// command line: the command the context names, with the environment of the host, within a bound of time.
// What it prints is read for the credential and is never logged, kept beyond its expiration or given to
// anyone.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { KubeConfig } from "@kubernetes/client-node/dist/config.js";
import { DiagnosticError } from "./diagnostic-transport.ts";

import type { Connection } from "../common/ipc";

export interface CredentialPlugin {
  command: string;
  args?: string[];
  env?: { name: string; value: string }[];
  apiVersion?: string;
  provideClusterInfo?: boolean;
}

export interface ContextEntry {
  context: string;
  cluster: {
    name: string;
    server: string;
    caData?: string;
    caFile?: string;
    skipTLSVerify?: boolean;
    proxyUrl?: string;
    tlsServerName?: string;
  };
  user: {
    name: string;
    token?: string;
    certData?: string;
    certFile?: string;
    keyData?: string;
    keyFile?: string;
    username?: string;
    password?: string;
    authProvider?: unknown;
    exec?: CredentialPlugin;
  };
}

export type ContextRead =
  | { entry: ContextEntry; digest: string; connection: Connection; configuration: KubeConfig }
  | { missing: "file" | "context" | "cluster" | "user" };

// What the plugin gives: a token, or a certificate with its key, good until a time when it says one.
export interface Credential {
  token?: string;
  certData?: string;
  keyData?: string;
  expires?: number;
}

const PLUGIN_TIMEOUT = 30_000;
const PLUGIN_OUTPUT_BOUND = 4 * 1024 * 1024;

function digestOfFile(file: string | undefined): string | undefined {
  if (!file) return undefined;
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch {
    return "unreadable";
  }
}

// What the connection of the entry is, and whether the adapter takes it.
export function connectionOf(entry: ContextEntry): Connection {
  const { cluster, user } = entry;

  if (cluster.skipTLSVerify) return { supported: false, reason: "insecure-tls" };
  if (cluster.proxyUrl) return { supported: false, reason: "proxy" };
  if (user.username || user.password) return { supported: false, reason: "basic" };
  if (user.exec?.command) return { supported: true, credential: "plugin" };
  if (user.authProvider) return { supported: false, reason: "auth-provider" };
  if ((user.certData || user.certFile) && (user.keyData || user.keyFile))
    return { supported: true, credential: "certificate" };
  if (user.token) return { supported: true, credential: "token" };
  return { supported: false, reason: "no-credential" };
}

// The entry of a context of a file, with its digest. The digest is of the fields that make the identity,
// and of the content of the files they name.
export function readContext(file: string, context: string): ContextRead {
  const configuration = new KubeConfig();

  try {
    configuration.loadFromFile(file);
  } catch {
    return { missing: "file" };
  }
  const found = configuration.getContextObject(context);

  if (!found) return { missing: "context" };
  const cluster = configuration.getCluster(found.cluster);
  const user = found.user ? configuration.getUser(found.user) : undefined;

  if (!cluster) return { missing: "cluster" };
  if (!user) return { missing: "user" };
  const exec = user.exec as CredentialPlugin | undefined;
  const entry: ContextEntry = {
    context,
    cluster: {
      name: cluster.name,
      server: cluster.server,
      caData: cluster.caData,
      caFile: cluster.caFile,
      skipTLSVerify: cluster.skipTLSVerify,
      proxyUrl: cluster.proxyUrl,
      tlsServerName: cluster.tlsServerName,
    },
    user: {
      name: user.name,
      token: user.token,
      certData: user.certData,
      certFile: user.certFile,
      keyData: user.keyData,
      keyFile: user.keyFile,
      username: user.username,
      password: user.password,
      authProvider: user.authProvider,
      exec: exec?.command
        ? {
            command: exec.command,
            args: exec.args ? [...exec.args] : undefined,
            env: exec.env ? exec.env.map((item) => ({ name: item.name, value: item.value })) : undefined,
            apiVersion: exec.apiVersion,
            provideClusterInfo: exec.provideClusterInfo,
          }
        : undefined,
    },
  };
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        entry,
        digestOfFile(entry.cluster.caFile),
        digestOfFile(entry.user.certFile),
        digestOfFile(entry.user.keyFile),
      ]),
    )
    .digest("hex");

  configuration.setCurrentContext(context);
  return { entry, digest, connection: connectionOf(entry), configuration };
}

// What runs the command of a plugin: the one of Node, or a fake of the tests.
export type Runner = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number; windowsHide: boolean },
  callback: (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void,
) => unknown;

// Runs the plugin of the entry for its credential. What it prints is read here and nowhere else; what it
// prints on failure is not read at all.
export function runCredentialPlugin(
  entry: ContextEntry,
  options: { timeoutMs?: number; environment?: NodeJS.ProcessEnv; run?: Runner } = {},
): Promise<Credential> {
  const plugin = entry.user.exec;

  if (!plugin?.command) return Promise.reject(new DiagnosticError("forbidden"));
  const environment: NodeJS.ProcessEnv = { ...(options.environment ?? process.env) };

  for (const item of plugin.env ?? []) environment[item.name] = item.value;
  if (plugin.provideClusterInfo) {
    environment.KUBERNETES_EXEC_INFO = JSON.stringify({
      apiVersion: plugin.apiVersion ?? "client.authentication.k8s.io/v1",
      kind: "ExecCredential",
      spec: {
        interactive: false,
        cluster: {
          server: entry.cluster.server,
          ...(entry.cluster.caData ? { "certificate-authority-data": entry.cluster.caData } : {}),
          ...(entry.cluster.tlsServerName ? { "tls-server-name": entry.cluster.tlsServerName } : {}),
        },
      },
    });
  }
  const run = options.run ?? (execFile as unknown as Runner);

  return new Promise((resolve, reject) => {
    try {
      run(
        plugin.command,
        plugin.args ?? [],
        {
          env: environment,
          timeout: options.timeoutMs ?? PLUGIN_TIMEOUT,
          maxBuffer: PLUGIN_OUTPUT_BOUND,
          windowsHide: true,
        },
        (error, stdout) => {
          if (error) {
            reject(new DiagnosticError("forbidden"));
            return;
          }
          resolve(readCredential(String(stdout)));
        },
      );
    } catch {
      reject(new DiagnosticError("forbidden"));
    }
  });
}

// What the plugin printed, read as the credential it must be; anything else is a refusal.
function readCredential(output: string): Credential {
  let parsed: unknown;

  try {
    parsed = JSON.parse(output);
  } catch {
    throw new DiagnosticError("forbidden");
  }
  if (typeof parsed !== "object" || parsed === null) throw new DiagnosticError("forbidden");
  const { kind, status } = parsed as { kind?: unknown; status?: unknown };

  if (kind !== "ExecCredential" || typeof status !== "object" || status === null)
    throw new DiagnosticError("forbidden");
  const fields = status as {
    token?: unknown;
    clientCertificateData?: unknown;
    clientKeyData?: unknown;
    expirationTimestamp?: unknown;
  };
  const credential: Credential = {};

  if (typeof fields.token === "string" && fields.token) credential.token = fields.token;
  if (
    typeof fields.clientCertificateData === "string" &&
    fields.clientCertificateData &&
    typeof fields.clientKeyData === "string" &&
    fields.clientKeyData
  ) {
    credential.certData = fields.clientCertificateData;
    credential.keyData = fields.clientKeyData;
  }
  if (!credential.token && !credential.certData) throw new DiagnosticError("forbidden");
  if (typeof fields.expirationTimestamp === "string") {
    const expires = Date.parse(fields.expirationTimestamp);

    if (Number.isFinite(expires)) credential.expires = expires;
  }
  return credential;
}
