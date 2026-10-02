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
import { dirname } from "node:path";
import { KubeConfig } from "@kubernetes/client-node/dist/config.js";
import { loadYaml } from "@kubernetes/client-node/dist/yaml.js";
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
    // Who the user acts as: the fields as, as-groups, as-uid and as-user-extra of the kubeconfig.
    impersonate?: Impersonation;
  };
}

export interface Impersonation {
  user?: string;
  groups?: unknown;
  uid?: unknown;
  extra?: unknown;
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

export const PLUGIN_TIMEOUT = 30_000;
const PLUGIN_OUTPUT_BOUND = 4 * 1024 * 1024;

// A plugin that gave no credential: it failed or is not installed, it did not end within its bound, or
// what it printed is not a credential. It is not a refusal of the cluster, which was not asked. It names
// the command by its file alone, which is safe to show; never its arguments, nor anything it printed.
export class CredentialPluginError extends DiagnosticError {
  readonly command: string;

  constructor(
    command: string,
    readonly reason: "failed" | "deadline" | "unreadable",
  ) {
    super("request-failed");
    this.name = "CredentialPluginError";
    this.command = nameOfCommand(command);
  }
}

// The file of a command, without its folder, which may name the account of the user; printable, short.
function nameOfCommand(command: string): string {
  const file = command.split(/[\\/]/).pop() ?? "";

  return file.replace(/[^\x20-\x7e]/g, " ").slice(0, 64) || "unnamed";
}

function digestOfFile(file: string | undefined): string | undefined {
  if (!file) return undefined;
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch {
    return "unreadable";
  }
}

// Whether a field of the kubeconfig says something: an empty list or map says nothing, as for kubectl.
function says(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

// What the connection of the entry is, and whether the adapter takes it.
export function connectionOf(entry: ContextEntry): Connection {
  const { cluster, user } = entry;

  if (cluster.skipTLSVerify) return { supported: false, reason: "insecure-tls" };
  if (cluster.proxyUrl) return { supported: false, reason: "proxy" };
  if (user.username || user.password) return { supported: false, reason: "basic" };
  // The client of Kubernetes sends the user it impersonates and nothing else of the impersonation: the
  // groups, the uid and the extra fields would be dropped, and the write would go as someone else.
  if (says(user.impersonate?.groups) || says(user.impersonate?.uid) || says(user.impersonate?.extra))
    return { supported: false, reason: "impersonation" };
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
  let raw: { users?: unknown };

  // The file is read once: the client of Kubernetes reads it for what it knows, and it is read again,
  // as it is, for the fields of the impersonation the client does not read.
  try {
    const text = readFileSync(file, "utf8");

    configuration.loadFromString(text);
    configuration.makePathsAbsolute(dirname(file));
    raw = loadYaml<{ users?: unknown }>(text);
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
  const impersonate = impersonationOf(raw, user.name, user.impersonateUser);
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
      impersonate,
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

// The impersonation of the user of a context, as the file writes it: the user the client of Kubernetes
// reads, with the groups, the uid and the extra fields it does not, copied as plain data.
function impersonationOf(raw: { users?: unknown }, name: string, user?: string): Impersonation | undefined {
  const listed = Array.isArray(raw?.users)
    ? (raw.users as { name?: unknown; user?: Record<string, unknown> }[]).find((item) => item?.name === name)
    : undefined;
  const fields = listed?.user && typeof listed.user === "object" ? listed.user : {};
  const copy = (value: unknown) => (says(value) ? JSON.parse(JSON.stringify(value)) : undefined);
  const impersonation: Impersonation = {
    ...(user ? { user } : {}),
    ...(says(fields["as-groups"]) ? { groups: copy(fields["as-groups"]) } : {}),
    ...(says(fields["as-uid"]) ? { uid: copy(fields["as-uid"]) } : {}),
    ...(says(fields["as-user-extra"]) ? { extra: copy(fields["as-user-extra"]) } : {}),
  };

  return Object.keys(impersonation).length ? impersonation : undefined;
}

// What runs the command of a plugin: the one of Node, or a fake of the tests. What it returns is the
// process, when it can be killed.
export type Runner = (
  command: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    timeout: number;
    killSignal: NodeJS.Signals;
    maxBuffer: number;
    windowsHide: boolean;
  },
  callback: (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void,
) => unknown;

// Kills what the runner returned, when it is a process that can be killed.
function kill(child: unknown): void {
  try {
    if (typeof child === "object" && child !== null && "kill" in child && typeof child.kill === "function")
      child.kill("SIGKILL");
  } catch {
    // The process has ended already.
  }
}

// Runs the plugin of the entry for its credential. What it prints is read here and nowhere else; what it
// prints on failure is not read at all. The promise settles once: with the credential, at the bound of
// time, or when the signal is aborted; the bound and the signal kill the command, whether it ends or not.
export function runCredentialPlugin(
  entry: ContextEntry,
  options: { timeoutMs?: number; environment?: NodeJS.ProcessEnv; run?: Runner; signal?: AbortSignal } = {},
): Promise<Credential> {
  const plugin = entry.user.exec;

  if (!plugin?.command) return Promise.reject(new DiagnosticError("forbidden"));
  if (options.signal?.aborted) return Promise.reject(new DiagnosticError("cancelled"));
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
  const bound = options.timeoutMs ?? PLUGIN_TIMEOUT;
  const { signal } = options;

  return new Promise((resolve, reject) => {
    let settled = false;
    let child: unknown;
    const finish = (error: DiagnosticError | undefined, credential?: Credential) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) {
        kill(child);
        reject(error);
      } else resolve(credential as Credential);
    };
    const abort = () => finish(new DiagnosticError("cancelled"));
    // The bound is kept here and not only by the runner: the runner calls back when the command closes
    // what it prints, which a command that ignores the request to end, or one it started, may never do.
    const timer = setTimeout(() => finish(new CredentialPluginError(plugin.command, "deadline")), bound);

    signal?.addEventListener("abort", abort, { once: true });
    try {
      child = run(
        plugin.command,
        plugin.args ?? [],
        { env: environment, timeout: bound, killSignal: "SIGKILL", maxBuffer: PLUGIN_OUTPUT_BOUND, windowsHide: true },
        (error, stdout) => {
          // Called by the runner, perhaps later than the bound: it settles nothing then, and never throws.
          if (error) {
            finish(new CredentialPluginError(plugin.command, "failed"));
            return;
          }
          const credential = readCredential(String(stdout));

          finish(credential ? undefined : new CredentialPluginError(plugin.command, "unreadable"), credential);
        },
      );
    } catch {
      finish(new CredentialPluginError(plugin.command, "failed"));
    }
  });
}

// What the plugin printed, read as the credential it must be; anything else is none. It never throws.
function readCredential(output: string): Credential | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(output);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const { kind, status } = parsed as { kind?: unknown; status?: unknown };

  if (kind !== "ExecCredential" || typeof status !== "object" || status === null) return undefined;
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
  if (!credential.token && !credential.certData) return undefined;
  if (typeof fields.expirationTimestamp === "string") {
    const expires = Date.parse(fields.expirationTimestamp);

    if (Number.isFinite(expires)) credential.expires = expires;
  }
  return credential;
}
