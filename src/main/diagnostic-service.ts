import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  ARTIFACT_TARGETS,
  type ArtifactTarget,
  type DiagnosticKubernetes,
  type DiagnosticObject,
} from "./diagnostic-kubernetes.ts";
import { type ArtifactRoute, DiagnosticError, downloadArtifact } from "./diagnostic-transport.ts";

export interface DiagnosticInput {
  requestId: string;
  clusterId: string;
  context: string;
  namespace: string;
  target: ArtifactTarget;
  name: string;
  uid: string;
  confirmation: string;
}
export interface DiagnosticResult {
  content: Buffer;
  request: { name: string; uid: string };
}
type Api = Pick<DiagnosticKubernetes, "binding" | "assertCurrent" | "read" | "createDownload" | "certificate">;
export interface DiagnosticOptions {
  route(
    url: string,
    input: Readonly<DiagnosticInput>,
    storage: DiagnosticObject,
    signal: AbortSignal,
  ): Promise<{ route: ArtifactRoute; close(): void | Promise<void> }>;
  onCreated?(request: { name: string; uid: string }): void;
  download?: typeof downloadArtifact;
  pollMs?: number;
  urlTimeoutMs?: number;
  totalMs?: number;
}

interface Active {
  signature: string;
  sender: number;
  promise: Promise<DiagnosticResult>;
  controller: AbortController;
}
interface Approval {
  sender: number;
  signature: string;
  expires: number;
}

function validateInput(value: DiagnosticInput): void {
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).sort().join(",") !== "clusterId,confirmation,context,name,namespace,requestId,target,uid"
  )
    throw new DiagnosticError("validation");
  if (
    !/^[a-f0-9-]{36}$/.test(value.requestId) ||
    !ARTIFACT_TARGETS.includes(value.target) ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value.namespace) ||
    value.namespace.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value.name) ||
    value.name.length > 210
  )
    throw new DiagnosticError("validation");
  for (const key of ["clusterId", "context", "uid", "confirmation"] as const)
    if (typeof value[key] !== "string" || !value[key] || value[key].length > 256)
      throw new DiagnosticError("validation");
}

function signature(value: Omit<DiagnosticInput, "confirmation" | "requestId">): string {
  return JSON.stringify([value.clusterId, value.context, value.namespace, value.target, value.name, value.uid]);
}

export class DiagnosticService {
  private enabledNamespace?: string;
  private readonly approvals = new Map<string, Approval>();
  private readonly active = new Map<string, Active>();
  private readonly finished = new Set<string>();
  private static running = 0;
  private static readonly queue: {
    resolve(): void;
    reject(error: DiagnosticError): void;
    signal: AbortSignal;
    abort(): void;
  }[] = [];

  constructor(
    private readonly api: Api,
    private readonly options: DiagnosticOptions,
  ) {}

  enableWrites(namespace?: string): void {
    this.invalidate();
    this.enabledNamespace = namespace;
  }

  invalidate(): void {
    this.enabledNamespace = undefined;
    this.approvals.clear();
    for (const operation of this.active.values()) operation.controller.abort();
  }

  confirm(sender: number, target: Omit<DiagnosticInput, "confirmation" | "requestId">): string {
    this.api.assertCurrent();
    const token = randomUUID();

    validateInput({ ...target, confirmation: token, requestId: randomUUID() });
    if (
      !Number.isSafeInteger(sender) ||
      sender < 0 ||
      target.clusterId !== this.api.binding.clusterId ||
      target.context !== this.api.binding.context ||
      target.namespace !== this.enabledNamespace
    )
      throw new DiagnosticError("forbidden");
    for (const [key, approval] of this.approvals) if (approval.expires <= Date.now()) this.approvals.delete(key);
    if (this.approvals.size >= 32) throw new DiagnosticError("forbidden");
    this.approvals.set(token, { sender, signature: signature(target), expires: Date.now() + 30_000 });
    return token;
  }

  cancel(sender: number, requestId: string): void {
    const operation = this.active.get(requestId);

    if (!operation || operation.sender !== sender) throw new DiagnosticError("forbidden");
    operation.controller.abort();
  }

  run(sender: number, input: DiagnosticInput, signal: AbortSignal): Promise<DiagnosticResult> {
    try {
      validateInput(input);
      this.api.assertCurrent();
      const fingerprint = `${signature(input)}:${input.confirmation}`;
      const existing = this.active.get(input.requestId);

      if (existing) {
        if (existing.sender !== sender || existing.signature !== fingerprint) throw new DiagnosticError("forbidden");
        return existing.promise;
      }
      if (this.finished.has(input.requestId)) throw new DiagnosticError("conflict");
      const approval = this.approvals.get(input.confirmation);

      if (
        !approval ||
        approval.sender !== sender ||
        approval.signature !== signature(input) ||
        approval.expires <= Date.now() ||
        input.namespace !== this.enabledNamespace ||
        input.clusterId !== this.api.binding.clusterId ||
        input.context !== this.api.binding.context
      )
        throw new DiagnosticError("forbidden");
      this.approvals.delete(input.confirmation);
      if (this.active.size >= 16) throw new DiagnosticError("forbidden");
      const controller = new AbortController();
      const aborted = () => controller.abort();

      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) controller.abort();
      const operation = this.execute(Object.freeze({ ...input }), controller).finally(() => {
        signal.removeEventListener("abort", aborted);
        this.active.delete(input.requestId);
        this.finished.add(input.requestId);
        if (this.finished.size > 256) this.finished.delete(this.finished.values().next().value as string);
      });

      this.active.set(input.requestId, { sender, signature: fingerprint, controller, promise: operation });
      return operation;
    } catch (error) {
      return Promise.reject(error instanceof DiagnosticError ? error : new DiagnosticError("validation"));
    }
  }

  private acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new DiagnosticError("cancelled"));
    if (DiagnosticService.running < 2) {
      DiagnosticService.running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        signal,
        abort: () => {
          const index = DiagnosticService.queue.indexOf(entry);
          if (index >= 0) DiagnosticService.queue.splice(index, 1);
          reject(new DiagnosticError("cancelled"));
        },
      };

      signal.addEventListener("abort", entry.abort, { once: true });
      DiagnosticService.queue.push(entry);
    });
  }

  private release(): void {
    const next = DiagnosticService.queue.shift();

    if (next) {
      next.signal.removeEventListener("abort", next.abort);
      next.resolve();
    } else DiagnosticService.running -= 1;
  }

  private async execute(input: Readonly<DiagnosticInput>, controller: AbortController): Promise<DiagnosticResult> {
    const signal = controller.signal;
    let acquired = false;
    let routed: Awaited<ReturnType<DiagnosticOptions["route"]>> | undefined;
    let expired = false;
    const total = this.options.totalMs ?? 120_000;
    const urlTimeout = this.options.urlTimeoutMs ?? 30_000;
    const interval = this.options.pollMs ?? 250;

    if (
      ![total, urlTimeout, interval].every(Number.isSafeInteger) ||
      total <= 0 ||
      total > 120_000 ||
      urlTimeout <= 0 ||
      urlTimeout > 30_000 ||
      interval <= 0 ||
      interval > 1000
    )
      throw new DiagnosticError("validation");
    const timer = setTimeout(() => {
      expired = true;
      controller.abort();
    }, total);
    const kind = input.target.startsWith("Backup") ? "Backup" : "Restore";
    const revalidate = async () => {
      this.api.assertCurrent();
      if (input.namespace !== this.enabledNamespace) throw new DiagnosticError("target-changed");
      const target = await this.api.read(kind, input.namespace, input.name, signal);

      if (
        target.metadata.uid !== input.uid ||
        target.metadata.name !== input.name ||
        target.metadata.namespace !== input.namespace
      )
        throw new DiagnosticError("target-changed");
      return target;
    };
    let result: DiagnosticResult | undefined;
    let failure: DiagnosticError | undefined;

    try {
      await this.acquire(signal);
      acquired = true;
      const target = await revalidate();
      const backup =
        kind === "Backup"
          ? target
          : await this.api.read("Backup", input.namespace, String(target.spec?.backupName ?? ""), signal);
      const storage = await this.api.read(
        "BackupStorageLocation",
        input.namespace,
        String(backup.spec?.storageLocation ?? ""),
        signal,
      );
      const objectStorage = storage.spec?.objectStorage as
        | { caCert?: string; caCertRef?: { name: string; key: string } }
        | undefined;
      const ca = await this.api.certificate(input.namespace, objectStorage ?? {}, signal);
      const requestName = `${input.name}-${input.requestId}`;
      let request: DiagnosticObject;

      await revalidate();
      try {
        request = await this.api.createDownload(
          input.namespace,
          input.target,
          input.name,
          requestName,
          input.requestId,
          signal,
        );
      } catch (error) {
        if (!(error instanceof DiagnosticError) || error.code !== "submission-unknown") throw error;
        try {
          request = await this.api.read("DownloadRequest", input.namespace, requestName, signal);
        } catch {
          throw new DiagnosticError("submission-unknown");
        }
      }
      if (
        !request.metadata.uid ||
        request.metadata.name !== requestName ||
        request.metadata.namespace !== input.namespace ||
        request.metadata.labels?.["freelensapp.io/diagnostic-request"] !== input.requestId
      )
        throw new DiagnosticError("submission-unknown");
      const identity = { name: requestName, uid: request.metadata.uid };

      this.options.onCreated?.(identity);
      const deadline = Date.now() + urlTimeout;
      let signedUrl = "";

      while (!signedUrl) {
        if (signal.aborted) throw new DiagnosticError("cancelled");
        await revalidate();
        request = await this.api.read("DownloadRequest", input.namespace, requestName, signal);
        if (
          request.metadata.uid !== identity.uid ||
          request.metadata.name !== identity.name ||
          request.metadata.namespace !== input.namespace ||
          request.metadata.labels?.["freelensapp.io/diagnostic-request"] !== input.requestId
        )
          throw new DiagnosticError("target-changed");
        const requestTarget = request.spec?.target as { kind?: string; name?: string } | undefined;

        if (requestTarget?.kind !== input.target || requestTarget.name !== input.name)
          throw new DiagnosticError("target-changed");
        if (request.status?.phase === "Failed") throw new DiagnosticError("request-failed");
        if (
          typeof request.status?.expiration === "string" &&
          (!Number.isFinite(Date.parse(request.status.expiration)) ||
            Date.parse(request.status.expiration) <= Date.now())
        )
          throw new DiagnosticError("deadline");
        if (typeof request.status?.downloadURL === "string" && request.status.downloadURL)
          signedUrl = request.status.downloadURL;
        else {
          if (Date.now() >= deadline) throw new DiagnosticError("deadline");
          await delay(Math.min(interval, deadline - Date.now()), undefined, { signal });
        }
      }
      routed = await this.options.route(signedUrl, input, storage, signal);
      const content = await (this.options.download ?? downloadArtifact)(signedUrl, { ...routed.route, ca }, signal);

      signedUrl = "";
      await revalidate();
      result = { content, request: identity };
    } catch (error) {
      failure = expired
        ? new DiagnosticError("deadline")
        : signal.aborted
          ? new DiagnosticError("cancelled")
          : error instanceof DiagnosticError
            ? error
            : new DiagnosticError("request-failed");
    } finally {
      clearTimeout(timer);
      try {
        await routed?.close();
      } catch {
        failure ??= new DiagnosticError("transport-unreachable");
      } finally {
        if (acquired) this.release();
      }
    }
    if (failure) throw failure;
    if (!result) throw new DiagnosticError("request-failed");
    return result;
  }
}
