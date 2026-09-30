import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { type DiagnosticInput, DiagnosticService } from "./diagnostic-service";
import { DiagnosticError } from "./diagnostic-transport";

import type { DiagnosticObject } from "./diagnostic-kubernetes";

function fixture(urlTimeoutMs = 30) {
  let targetUid = "target-uid";
  let current = true;
  let phase = "Processed";
  let ambiguous = false;
  let request: DiagnosticObject;
  const api = {
    binding: { clusterId: "cluster", context: "context", kubeconfigPath: "/synthetic" },
    assertCurrent: () => {
      if (!current) throw new DiagnosticError("target-changed");
    },
    read: vi.fn(async (kind: string): Promise<DiagnosticObject> => {
      if (kind === "Backup")
        return {
          metadata: { name: "backup", namespace: "fixture", uid: targetUid },
          spec: { storageLocation: "default" },
        };
      if (kind === "BackupStorageLocation")
        return { metadata: { name: "default", namespace: "fixture", uid: "bsl-uid" }, spec: { objectStorage: {} } };
      return {
        ...request,
        status:
          phase === "Processed"
            ? { phase, downloadURL: "https://storage.example.invalid/artifact?signature=PRIVATE-SENTINEL" }
            : { phase, message: "PRIVATE-SENTINEL" },
      };
    }),
    createDownload: vi.fn(
      async (namespace: string, kind: string, targetName: string, requestName: string, requestId: string) => {
        request = {
          metadata: {
            namespace,
            name: requestName,
            uid: "request-uid",
            labels: { "freelensapp.io/diagnostic-request": requestId },
          },
          spec: { target: { kind, name: targetName } },
        };
        if (ambiguous) throw new DiagnosticError("submission-unknown");
        return request;
      },
    ),
    certificate: vi.fn(async () => undefined),
  };
  const close = vi.fn();
  const download = vi.fn(async () => Buffer.from("synthetic log"));
  const service = new DiagnosticService(api, {
    pollMs: 5,
    urlTimeoutMs,
    route: async () => ({
      route: {
        origin: "https://storage.example.invalid",
        pathname: "/artifact",
        address: "127.0.0.1",
        port: 1234,
        mode: "test",
      },
      close,
    }),
    download,
  });
  const target = {
    clusterId: "cluster",
    context: "context",
    namespace: "fixture",
    target: "BackupLog",
    name: "backup",
    uid: "target-uid",
  } as const;
  const input = () => ({ ...target, requestId: randomUUID(), confirmation: service.confirm("frame-7", target) });

  return {
    service,
    api,
    input,
    target,
    close,
    download,
    setUid: (value: string) => {
      targetUid = value;
    },
    setCurrent: (value: boolean) => {
      current = value;
    },
    setPhase: (value: string) => {
      phase = value;
    },
    ambiguous: () => {
      ambiguous = true;
    },
  };
}

describe("confirmed diagnostic lifecycle", () => {
  it("starts write-disabled and rejects unconfirmed or wrong-sender requests", async () => {
    const value = fixture();

    expect(() => value.input()).toThrow("forbidden");
    value.service.enableWrites("fixture");
    const input = value.input();

    await expect(value.service.run("frame-8", input, new AbortController().signal)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(value.api.createDownload).not.toHaveBeenCalled();
  });

  it("deduplicates in-flight IDs, returns no signed URL and closes its route", async () => {
    const value = fixture();

    value.service.enableWrites("fixture");
    const input = value.input();
    const first = value.service.run("frame-7", input, new AbortController().signal);
    const second = value.service.run("frame-7", input, new AbortController().signal);

    expect(first).toBe(second);
    const result = await first;

    expect(result.content.toString()).toBe("synthetic log");
    expect(JSON.stringify(result)).not.toContain("PRIVATE-SENTINEL");
    expect(value.api.createDownload).toHaveBeenCalledTimes(1);
    expect(value.close).toHaveBeenCalledTimes(1);
    await expect(value.service.run("frame-7", input, new AbortController().signal)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it.each(["BackupContents", "UnexpectedKind"])("rejects non-allowlisted targets: %s", async (target) => {
    const value = fixture();

    value.service.enableWrites("fixture");
    await expect(
      value.service.run("frame-7", { ...value.input(), target } as DiagnosticInput, new AbortController().signal),
    ).rejects.toMatchObject({ code: "validation" });
    expect(value.api.createDownload).not.toHaveBeenCalled();
  });

  it("rejects unknown fields, changed UID and selection before submission", async () => {
    const value = fixture();

    value.service.enableWrites("fixture");
    const input = value.input();

    await expect(
      value.service.run(
        "frame-7",
        { ...input, url: "https://example.invalid" } as DiagnosticInput,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "validation" });
    value.setUid("recreated-uid");
    await expect(value.service.run("frame-7", input, new AbortController().signal)).rejects.toMatchObject({
      code: "target-changed",
    });
    value.setCurrent(false);
    expect(() => value.input()).toThrow("target-changed");
    expect(value.api.createDownload).not.toHaveBeenCalled();
  });

  it.each([
    ["New", "deadline"],
    ["Failed", "request-failed"],
  ])("handles %s without leaking controller errors", async (phase, code) => {
    const value = fixture();

    value.service.enableWrites("fixture");
    value.setPhase(phase);
    await expect(value.service.run("frame-7", value.input(), new AbortController().signal)).rejects.toMatchObject({
      code,
      message: `Diagnostic operation failed: ${code}`,
    });
    expect(value.download).not.toHaveBeenCalled();
  });

  it("reconciles an ambiguous POST with the exact identity and never posts again", async () => {
    const value = fixture();

    value.service.enableWrites("fixture");
    value.ambiguous();
    await expect(value.service.run("frame-7", value.input(), new AbortController().signal)).resolves.toHaveProperty(
      "content",
    );
    expect(value.api.createDownload).toHaveBeenCalledTimes(1);
  });

  it("rejects expired URLs and sanitizes errors from route cleanup", async () => {
    const value = fixture();

    value.service.enableWrites("fixture");
    const original = value.api.read.getMockImplementation();

    if (!original) throw new Error("Missing API fixture implementation");
    value.api.read.mockImplementation(async (kind: string) => {
      const result = await original(kind);
      if (kind === "DownloadRequest")
        return {
          ...result,
          status: { phase: "Processed", expiration: "2000-01-01T00:00:00Z", downloadURL: "PRIVATE-SENTINEL" },
        } as DiagnosticObject;
      return result;
    });
    await expect(value.service.run("frame-7", value.input(), new AbortController().signal)).rejects.toMatchObject({
      code: "deadline",
    });
    expect(value.download).not.toHaveBeenCalled();
    value.api.read.mockImplementation(original);
    value.close.mockImplementation(() => {
      throw new Error("PRIVATE-SENTINEL");
    });
    await expect(value.service.run("frame-7", value.input(), new AbortController().signal)).rejects.toMatchObject({
      code: "transport-unreachable",
      message: "Diagnostic operation failed: transport-unreachable",
    });
    value.download.mockRejectedValueOnce(new DiagnosticError("artifact-missing"));
    await expect(value.service.run("frame-7", value.input(), new AbortController().signal)).rejects.toMatchObject({
      code: "artifact-missing",
    });
  });

  it("limits concurrency across service instances and cancels queued work before POST", async () => {
    const first = fixture(1000);
    const second = fixture(1000);
    const queued = fixture(1000);

    for (const value of [first, second, queued]) {
      value.service.enableWrites("fixture");
      value.setPhase("New");
    }
    const firstInput = first.input();
    const secondInput = second.input();
    const queuedInput = queued.input();
    const results = [
      first.service.run("frame-7", firstInput, new AbortController().signal),
      second.service.run("frame-7", secondInput, new AbortController().signal),
      queued.service.run("frame-7", queuedInput, new AbortController().signal),
    ].map((operation) => operation.catch((error: unknown) => error));

    await vi.waitFor(() => {
      expect(first.api.createDownload).toHaveBeenCalledOnce();
      expect(second.api.createDownload).toHaveBeenCalledOnce();
    });
    expect(queued.api.createDownload).not.toHaveBeenCalled();
    queued.service.cancel("frame-7", queuedInput.requestId);
    first.service.invalidate();
    second.service.invalidate();
    expect(await Promise.all(results)).toEqual([
      expect.objectContaining({ code: "cancelled" }),
      expect.objectContaining({ code: "cancelled" }),
      expect.objectContaining({ code: "cancelled" }),
    ]);
  });

  it("cancels a pending poll without deleting the controller request", async () => {
    const value = fixture(1000);

    value.service.enableWrites("fixture");
    value.setPhase("New");
    const input = value.input();
    const pending = value.service.run("frame-7", input, new AbortController().signal);
    const cancelled = expect(pending).rejects.toMatchObject({ code: "cancelled" });

    await vi.waitFor(() => expect(value.api.createDownload).toHaveBeenCalledOnce());
    expect(() => value.service.cancel("frame-9", input.requestId)).toThrow("forbidden");
    value.service.cancel("frame-7", input.requestId);
    await cancelled;
    expect(value.download).not.toHaveBeenCalled();
  });
});
