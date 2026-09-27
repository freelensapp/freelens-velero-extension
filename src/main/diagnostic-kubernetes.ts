import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { type RequestOptions, request } from "node:https";
import { isAbsolute } from "node:path";
import { KubeConfig } from "@kubernetes/client-node/dist/config.js";
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

export class DiagnosticKubernetes {
  readonly binding: Readonly<KubernetesBinding>;
  readonly configuration: KubeConfig;
  private readonly fingerprint: string;
  private readonly endpoint: URL;

  constructor(
    binding: KubernetesBinding,
    private readonly isCurrent: () => boolean,
    private readonly requestLabels: Readonly<Record<string, string>> = {},
  ) {
    this.binding = Object.freeze({ ...binding });
    try {
      if (!binding.clusterId || !binding.context || !isAbsolute(binding.kubeconfigPath) || !isCurrent())
        throw new DiagnosticError("validation");
      this.fingerprint = this.hash();
      this.configuration = new KubeConfig();
      this.configuration.loadFromFile(binding.kubeconfigPath);
      if (this.configuration.getContexts().filter((context) => context.name === binding.context).length !== 1)
        throw new DiagnosticError("validation");
      this.configuration.setCurrentContext(binding.context);
      const cluster = this.configuration.getCurrentCluster();
      const user = this.configuration.getCurrentUser();

      if (
        !cluster ||
        !user ||
        cluster.skipTLSVerify ||
        cluster.proxyUrl ||
        user.exec ||
        user.authProvider ||
        user.username ||
        (!user.token && !user.certData && !user.certFile)
      )
        throw new DiagnosticError("validation");
      this.endpoint = new URL(cluster.server);
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

  private hash(): string {
    return createHash("sha256").update(readFileSync(this.binding.kubeconfigPath)).digest("hex");
  }

  assertCurrent(): void {
    try {
      if (
        !this.isCurrent() ||
        this.hash() !== this.fingerprint ||
        this.configuration.getCurrentContext() !== this.binding.context
      )
        throw new DiagnosticError("target-changed");
    } catch {
      throw new DiagnosticError("target-changed");
    }
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
      await this.configuration.applyToHTTPSOptions(authentication);
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
