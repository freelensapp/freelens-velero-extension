import { X509Certificate } from "node:crypto";
import { type RequestOptions, request } from "node:https";
import { isAbsolute } from "node:path";
import { KubeConfig } from "@kubernetes/client-node/dist/config.js";
import { type ContextEntry, type Credential, readContext, runCredentialPlugin } from "./context-identity.ts";
import { DiagnosticError } from "./diagnostic-transport.ts";

export const ARTIFACT_TARGETS = [
  "BackupLog",
  "RestoreLog",
  "BackupResults",
  "RestoreResults",
  "BackupResourceList",
  "RestoreResourceList",
  "BackupVolumeInfos",
  "RestoreVolumeInfo",
] as const;
export type ArtifactTarget = (typeof ARTIFACT_TARGETS)[number];
export interface KubernetesBinding {
  clusterId: string;
  context: string;
  kubeconfigPath: string;
}
export interface DiagnosticObject {
  apiVersion?: string;
  kind?: string;
  metadata: { name: string; namespace?: string; uid: string; labels?: Record<string, string> };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  data?: Record<string, string>;
}
const resources = {
  Backup: "backups",
  Restore: "restores",
  BackupStorageLocation: "backupstoragelocations",
  DownloadRequest: "downloadrequests",
  ServerStatusRequest: "serverstatusrequests",
  DeleteBackupRequest: "deletebackuprequests",
  Pod: "pods",
  Service: "services",
  Secret: "secrets",
} as const;
export type DiagnosticKind = keyof typeof resources;

function name(value: string, maximum = 253): string {
  if (typeof value !== "string" || value.length > maximum || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value))
    throw new DiagnosticError("validation");
  return value;
}

// The adapter binds to one context of one kubeconfig, by the entry of the context: the address of the
// server, its certificate authority and the credential of the user. It takes a client certificate, a token
// or a plugin that gives a credential, which it runs within a bound and reads for the credential alone;
// it refuses an authentication provider, a proxy, a user name with a password and a verification of TLS
// turned off. The entry is read again before every request: a change of it is a change of the target, a
// change of another context of the same file is not.
export class DiagnosticKubernetes {
  readonly binding: Readonly<KubernetesBinding>;
  readonly configuration: KubeConfig;
  private readonly entry: ContextEntry;
  private readonly fingerprint: string;
  private readonly endpoint: URL;
  // The credential the plugin gave, kept until it expires and never beyond the adapter.
  private credential?: Credential;

  constructor(
    binding: KubernetesBinding,
    private readonly isCurrent: () => boolean,
    private readonly requestLabels: Readonly<Record<string, string>> = {},
  ) {
    this.binding = Object.freeze({ ...binding });
    try {
      if (!binding.clusterId || !binding.context || !isAbsolute(binding.kubeconfigPath) || !isCurrent())
        throw new DiagnosticError("validation");
      const read = readContext(binding.kubeconfigPath, binding.context);

      if ("missing" in read || !read.connection.supported) throw new DiagnosticError("validation");
      this.entry = read.entry;
      this.fingerprint = read.digest;
      this.configuration = read.configuration;
      this.endpoint = new URL(read.entry.cluster.server);
      if (
        this.endpoint.protocol !== "https:" ||
        this.endpoint.username ||
        this.endpoint.password ||
        this.endpoint.search ||
        this.endpoint.hash
      )
        throw new DiagnosticError("validation");
    } catch {
      throw new DiagnosticError("validation");
    }
  }

  // Whether the entry of the context is what it was when the adapter was made.
  assertCurrent(): void {
    try {
      const read = readContext(this.binding.kubeconfigPath, this.binding.context);

      if (!this.isCurrent() || "missing" in read || read.digest !== this.fingerprint)
        throw new DiagnosticError("target-changed");
    } catch {
      throw new DiagnosticError("target-changed");
    }
  }

  // The options of a request, with the credential of the user: the one of the entry, or the one its
  // plugin gives, which is asked of the plugin when there is none or the one there is expired.
  private async authenticate(options: RequestOptions): Promise<void> {
    if (!this.entry.user.exec) {
      await this.configuration.applyToHTTPSOptions(options);
      return;
    }
    if (!this.credential || (this.credential.expires !== undefined && this.credential.expires <= Date.now()))
      this.credential = await runCredentialPlugin(this.entry);
    // The configuration is copied with the credential in place of the plugin: the client of Kubernetes
    // would otherwise run the plugin itself, without a bound.
    const copy = new KubeConfig();
    const cluster = this.configuration.getCluster(this.entry.cluster.name);

    if (!cluster) throw new DiagnosticError("target-changed");
    copy.loadFromOptions({
      clusters: [cluster],
      users: [
        {
          name: this.entry.user.name,
          ...(this.credential.token ? { token: this.credential.token } : {}),
          ...(this.credential.certData ? { certData: this.credential.certData, keyData: this.credential.keyData } : {}),
        },
      ],
      contexts: [{ name: this.binding.context, cluster: cluster.name, user: this.entry.user.name }],
      currentContext: this.binding.context,
    });
    await copy.applyToHTTPSOptions(options);
  }

  private path(kind: DiagnosticKind, namespace: string, objectName?: string): string {
    const base = ["Pod", "Service", "Secret"].includes(kind) ? "/api/v1" : "/apis/velero.io/v1";

    return `${base}/namespaces/${name(namespace, 63)}/${resources[kind]}${objectName ? `/${name(objectName)}` : ""}`;
  }

  private async send(
    method: "GET" | "POST",
    path: string,
    signal: AbortSignal,
    body?: unknown,
  ): Promise<DiagnosticObject> {
    this.assertCurrent();
    if (signal.aborted) throw new DiagnosticError("cancelled");
    const authentication: RequestOptions = {};

    try {
      await this.authenticate(authentication);
    } catch {
      throw new DiagnosticError("forbidden");
    }
    this.assertCurrent();
    if (signal.aborted) throw new DiagnosticError("cancelled");
    const payload = body === undefined ? undefined : JSON.stringify(body);

    return new Promise((resolve, reject) => {
      let settled = false;
      let incoming: import("node:http").IncomingMessage | undefined;
      const chunks: Buffer[] = [];
      let size = 0;
      const outgoing = request({
        ...authentication,
        hostname: this.endpoint.hostname,
        port: this.endpoint.port || 443,
        path: `${this.endpoint.pathname.replace(/\/$/, "")}${path}`,
        method,
        agent: false,
        rejectUnauthorized: true,
        headers: {
          ...authentication.headers,
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      });
      const finish = (error?: DiagnosticError, value?: DiagnosticObject) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        outgoing.destroy();
        incoming?.destroy();
        chunks.length = 0;
        if (error) reject(error);
        else resolve(value as DiagnosticObject);
      };
      const abort = () => finish(new DiagnosticError("cancelled"));
      const timer = setTimeout(
        () =>
          finish(new DiagnosticError(method === "POST" && outgoing.headersSent ? "submission-unknown" : "deadline")),
        10_000,
      );

      signal.addEventListener("abort", abort, { once: true });
      outgoing.once("error", () =>
        finish(
          new DiagnosticError(
            method === "POST" && outgoing.headersSent ? "submission-unknown" : "transport-unreachable",
          ),
        ),
      );
      outgoing.once("response", (response) => {
        incoming = response;
        const code = response.statusCode ?? 0;

        if (code < 200 || code >= 300) {
          finish(
            new DiagnosticError(
              code === 403 || code === 401
                ? "forbidden"
                : code === 404
                  ? "not-found"
                  : code === 409
                    ? "conflict"
                    : method === "POST" && code >= 500
                      ? "submission-unknown"
                      : "request-failed",
            ),
          );
          return;
        }
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 4 * 1024 ** 2) finish(new DiagnosticError("payload-too-large"));
          else chunks.push(chunk);
        });
        response.once("error", () =>
          finish(new DiagnosticError(method === "POST" ? "submission-unknown" : "transport-unreachable")),
        );
        response.once("end", () => {
          try {
            this.assertCurrent();
            const result = JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as DiagnosticObject;

            if (!result || typeof result !== "object" || !result.metadata)
              throw new DiagnosticError(method === "POST" ? "submission-unknown" : "request-failed");
            finish(undefined, result);
          } catch (error) {
            finish(
              error instanceof DiagnosticError
                ? error
                : new DiagnosticError(method === "POST" ? "submission-unknown" : "request-failed"),
            );
          }
        });
      });
      if (signal.aborted) abort();
      else outgoing.end(payload);
    });
  }

  async read(
    kind: DiagnosticKind,
    namespace: string,
    objectName: string,
    signal: AbortSignal,
  ): Promise<DiagnosticObject> {
    if (!(kind in resources)) throw new DiagnosticError("validation");
    const result = await this.send("GET", this.path(kind, namespace, objectName), signal);

    if (result.metadata.name !== objectName || result.metadata.namespace !== namespace || !result.metadata.uid)
      throw new DiagnosticError("target-changed");
    return result;
  }

  createDownload(
    namespace: string,
    target: ArtifactTarget,
    targetName: string,
    requestName: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<DiagnosticObject> {
    if (!ARTIFACT_TARGETS.includes(target) || !/^[a-f0-9-]{36}$/.test(requestId))
      throw new DiagnosticError("validation");
    return this.send("POST", this.path("DownloadRequest", namespace), signal, {
      apiVersion: "velero.io/v1",
      kind: "DownloadRequest",
      metadata: {
        namespace: name(namespace, 63),
        name: name(requestName),
        labels: { ...this.requestLabels, "freelensapp.io/diagnostic-request": requestId },
      },
      spec: { target: { kind: target, name: name(targetName) } },
    });
  }

  createGenerated(
    kind: "ServerStatusRequest" | "DeleteBackupRequest",
    namespace: string,
    prefix: string,
    signal: AbortSignal,
    backup?: { name: string; uid: string },
  ): Promise<DiagnosticObject> {
    if (!["ServerStatusRequest", "DeleteBackupRequest"].includes(kind) || !prefix.endsWith("-"))
      throw new DiagnosticError("validation");
    name(prefix.slice(0, -1), 210);
    if (kind === "DeleteBackupRequest" && (!backup?.uid || !backup.name)) throw new DiagnosticError("validation");
    return this.send("POST", this.path(kind, namespace), signal, {
      apiVersion: "velero.io/v1",
      kind,
      metadata: {
        namespace: name(namespace, 63),
        generateName: prefix,
        labels: {
          ...this.requestLabels,
          ...(backup ? { "velero.io/backup-name": name(backup.name), "velero.io/backup-uid": backup.uid } : {}),
        },
      },
      spec: kind === "DeleteBackupRequest" ? { backupName: backup?.name } : {},
    });
  }

  async certificate(
    namespace: string,
    storage: { caCert?: string; caCertRef?: { name: string; key: string } },
    signal: AbortSignal,
  ): Promise<string | undefined> {
    if (storage.caCert && storage.caCertRef) throw new DiagnosticError("validation");
    let value = storage.caCert;

    if (storage.caCertRef) {
      const reference = storage.caCertRef;
      if (!/^[a-zA-Z0-9._-]+$/.test(reference.key)) throw new DiagnosticError("validation");
      const secret = await this.read("Secret", namespace, reference.name, signal);

      value = secret.data?.[reference.key];
      if (!value) throw new DiagnosticError("tls-invalid");
    }
    if (!value) return undefined;
    try {
      if (value.length > 1024 * 1024) throw new Error();
      const pem = value.startsWith("-----BEGIN CERTIFICATE-----")
        ? value
        : Buffer.from(value, "base64").toString("utf8");

      new X509Certificate(pem);
      return pem;
    } catch {
      throw new DiagnosticError("tls-invalid");
    }
  }
}
