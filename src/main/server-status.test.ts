import { describe, expect, it, vi } from "vitest";
import { DiagnosticError } from "./diagnostic-transport";
import { readServerStatus, SERVER_STATUS_PREFIX, serverStatusFailure } from "./server-status";

import type { DiagnosticObject } from "./diagnostic-kubernetes";
import type { ServerStatusApi } from "./server-status";

function fixture(options: { processedAfterReads?: number; created?: Partial<DiagnosticObject["metadata"]> } = {}) {
  let reads = 0;
  let now = 1_700_000_000_000;
  const created: DiagnosticObject = {
    metadata: { name: "freelens-velero-abcde", namespace: "velero", uid: "request-uid", ...options.created },
    spec: {},
  };
  const api: ServerStatusApi = {
    assertCurrent: vi.fn(),
    createGenerated: vi.fn(async () => created),
    read: vi.fn(async (): Promise<DiagnosticObject> => {
      reads += 1;
      if (options.processedAfterReads !== undefined && reads > options.processedAfterReads)
        return {
          ...created,
          status: {
            phase: "Processed",
            serverVersion: "v1.18.2",
            processedTimestamp: "2026-09-30T10:00:00Z",
            plugins: [
              { name: "velero.io/aws", kind: "ObjectStore" },
              { name: "velero.io/pod-volume-restore", kind: "RestoreItemAction" },
              { name: "broken" },
            ],
          },
        };
      return { ...created, status: {} };
    }),
  };
  const steps: [string, number | undefined][] = [];

  return {
    api,
    steps,
    options: {
      signal: new AbortController().signal,
      onStep: (step: string, count?: number) => steps.push([step, count]),
      intervalMs: 1,
      waitMs: 400,
      now: () => {
        now += 10;
        return now;
      },
    },
  };
}

describe("the version of the server", () => {
  it("creates the request with its prefix, waits for Processed and reads the version and the plugins", async () => {
    const { api, options, steps } = fixture({ processedAfterReads: 2 });

    await expect(readServerStatus(api, "velero", options)).resolves.toEqual({
      version: "v1.18.2",
      processed: "2026-09-30T10:00:00Z",
      plugins: [
        { name: "velero.io/aws", kind: "ObjectStore" },
        { name: "velero.io/pod-volume-restore", kind: "RestoreItemAction" },
      ],
      request: { name: "freelens-velero-abcde", uid: "request-uid" },
    });
    expect(api.createGenerated).toHaveBeenCalledWith(
      "ServerStatusRequest",
      "velero",
      SERVER_STATUS_PREFIX,
      options.signal,
    );
    expect(steps[0]).toEqual(["creating", undefined]);
    expect(steps[1]).toEqual(["waiting", 0]);
  });

  it("ends with the deadline when the server does not process the request in time, and deletes nothing", async () => {
    const { api, options } = fixture();

    await expect(readServerStatus(api, "velero", options)).rejects.toMatchObject({ code: "deadline" });
    expect(api.read).toHaveBeenCalled();
    expect(Object.keys(api)).not.toContain("delete");
  });

  it("stops when the request read back is not the one created", async () => {
    const { api, options } = fixture({ processedAfterReads: 0 });

    (api.read as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      metadata: { name: "freelens-velero-abcde", namespace: "velero", uid: "another-uid" },
      status: { phase: "Processed" },
    });
    await expect(readServerStatus(api, "velero", options)).rejects.toMatchObject({ code: "target-changed" });
  });

  it("ends as cancelled when the signal is aborted while it waits", async () => {
    const { api, options } = fixture();
    const controller = new AbortController();

    setTimeout(() => controller.abort(), 5);
    await expect(
      readServerStatus(api, "velero", { ...options, signal: controller.signal, waitMs: 10_000 }),
    ).rejects.toMatchObject({
      code: "cancelled",
    });
  });

  it("gives words to each way it ends, without the raw error", () => {
    expect(serverStatusFailure(new DiagnosticError("forbidden"))).toMatchObject({
      code: "forbidden",
      stage: "creation",
    });
    expect(serverStatusFailure(new DiagnosticError("forbidden"), "x").text).toContain("refused to read");
    expect(serverStatusFailure(new DiagnosticError("deadline"), "x")).toMatchObject({ code: "deadline", retry: true });
    expect(serverStatusFailure(new DiagnosticError("submission-unknown")).text).toContain("freelens-velero-");
    expect(serverStatusFailure(new Error("PRIVATE-SENTINEL"))).toMatchObject({ code: "request-failed" });
    expect(JSON.stringify(serverStatusFailure(new Error("PRIVATE-SENTINEL")))).not.toContain("PRIVATE-SENTINEL");
  });
});
