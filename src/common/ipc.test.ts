import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  REQUEST_BOUND,
  readAnswer,
  readGateEnableRequest,
  readGateState,
  readGateStateRequest,
  readServerStatusValue,
  readWriteCancelRequest,
  readWriteConfirmAnswer,
  readWriteConfirmRequest,
  readWriteRunRequest,
  readWriteStatus,
  readWriteStatusRequest,
} from "./ipc";

const cluster = "86a008d2588de4178aa2ac8a245ac1f4";
const target = { kind: "Backup", name: "nightly", uid: "0e7c5b7a-uid" };

describe("the requests between the processes", () => {
  it("reads a request of the state of the gate, and refuses what is not one", () => {
    expect(readGateStateRequest({ cluster })).toEqual({ cluster });
    expect(readGateStateRequest({ cluster, extra: 1 })).toBeUndefined();
    expect(readGateStateRequest({ cluster: "not a cluster!" })).toBeUndefined();
    expect(readGateStateRequest({ cluster: ["a"] })).toBeUndefined();
    expect(readGateStateRequest("cluster")).toBeUndefined();
    expect(readGateStateRequest(null)).toBeUndefined();
    expect(readGateStateRequest({})).toBeUndefined();
  });

  it("reads a request that turns writes on, with the words of the dialog", () => {
    const request = { cluster, namespace: "velero", confirmation: { context: "kind-demo", namespace: "velero" } };

    expect(readGateEnableRequest(request)).toEqual(request);
    expect(readGateEnableRequest({ ...request, namespace: "Velero" })).toBeUndefined();
    expect(readGateEnableRequest({ ...request, namespace: "a".repeat(64) })).toBeUndefined();
    expect(readGateEnableRequest({ ...request, confirmation: { context: "kind-demo" } })).toBeUndefined();
    expect(readGateEnableRequest({ ...request, confirmation: { context: "", namespace: "velero" } })).toBeUndefined();
    expect(readGateEnableRequest({ ...request, confirmation: { context: 1, namespace: "velero" } })).toBeUndefined();
    expect(readGateEnableRequest({ cluster, namespace: "velero" })).toBeUndefined();
  });

  it("reads a confirmation of a write, of one object for a DownloadRequest and of none for a ServerStatusRequest", () => {
    expect(readWriteConfirmRequest({ cluster, namespace: "velero", kind: "DownloadRequest", target })).toEqual({
      cluster,
      namespace: "velero",
      kind: "DownloadRequest",
      target,
    });
    expect(readWriteConfirmRequest({ cluster, namespace: "velero", kind: "ServerStatusRequest" })).toEqual({
      cluster,
      namespace: "velero",
      kind: "ServerStatusRequest",
    });
    expect(readWriteConfirmRequest({ cluster, namespace: "velero", kind: "DownloadRequest" })).toBeUndefined();
    expect(
      readWriteConfirmRequest({ cluster, namespace: "velero", kind: "ServerStatusRequest", target }),
    ).toBeUndefined();
    expect(readWriteConfirmRequest({ cluster, namespace: "velero", kind: "Backup", target })).toBeUndefined();
    expect(
      readWriteConfirmRequest({
        cluster,
        namespace: "velero",
        kind: "DownloadRequest",
        target: { ...target, kind: "Pod" },
      }),
    ).toBeUndefined();
    expect(
      readWriteConfirmRequest({
        cluster,
        namespace: "velero",
        kind: "DownloadRequest",
        target: { ...target, uid: "" },
      }),
    ).toBeUndefined();
    expect(
      readWriteConfirmRequest({
        cluster,
        namespace: "velero",
        kind: "DownloadRequest",
        target: { ...target, name: "Not A Name" },
      }),
    ).toBeUndefined();
    expect(
      readWriteConfirmRequest({
        cluster,
        namespace: "velero",
        kind: "DownloadRequest",
        target: { ...target, more: 1 },
      }),
    ).toBeUndefined();
  });

  it("reads a run of a write, with its token and its identifier", () => {
    const token = randomUUID();
    const request = randomUUID();

    expect(readWriteRunRequest({ cluster, namespace: "velero", kind: "ServerStatusRequest", token, request })).toEqual({
      cluster,
      namespace: "velero",
      kind: "ServerStatusRequest",
      token,
      request,
    });
    expect(
      readWriteRunRequest({
        cluster,
        namespace: "velero",
        kind: "DownloadRequest",
        target,
        token,
        request,
        artifact: "BackupLog",
      }),
    ).toEqual({ cluster, namespace: "velero", kind: "DownloadRequest", target, token, request, artifact: "BackupLog" });
    expect(
      readWriteRunRequest({ cluster, namespace: "velero", kind: "DownloadRequest", target, token, request }),
    ).toBeUndefined();
    expect(
      readWriteRunRequest({ cluster, namespace: "velero", kind: "ServerStatusRequest", token, request, artifact: "x" }),
    ).toBeUndefined();
    expect(
      readWriteRunRequest({ cluster, namespace: "velero", kind: "ServerStatusRequest", token: "abc", request }),
    ).toBeUndefined();
    expect(
      readWriteRunRequest({ cluster, namespace: "velero", kind: "ServerStatusRequest", token, request: [request] }),
    ).toBeUndefined();
    expect(readWriteRunRequest({ cluster, namespace: "velero", kind: "ServerStatusRequest", token })).toBeUndefined();
  });

  it("reads the status and the cancellation of a write", () => {
    const request = randomUUID();

    expect(readWriteStatusRequest({ cluster, request })).toEqual({ cluster, request });
    expect(readWriteCancelRequest({ cluster, request })).toEqual({ cluster, request });
    expect(readWriteStatusRequest({ cluster, request: "1" })).toBeUndefined();
    expect(readWriteStatusRequest({ cluster, request, token: request })).toBeUndefined();
  });

  it("refuses a request beyond the bound before reading it", () => {
    expect(readGateStateRequest({ cluster, padding: "x".repeat(REQUEST_BOUND) })).toBeUndefined();
    expect(readWriteStatusRequest({ cluster: "x".repeat(REQUEST_BOUND + 1), request: randomUUID() })).toBeUndefined();
  });
});

describe("the answers between the processes", () => {
  it("reads an answer with its value, and a failure with its code, its stage, its retry and its words", () => {
    expect(readAnswer({ ok: true, value: { token: randomUUID(), expires: 1 } }, readWriteConfirmAnswer)).toMatchObject({
      ok: true,
    });
    expect(
      readAnswer(
        { ok: false, code: "forbidden", stage: "gate", retry: false, text: "Writes are off." },
        readWriteConfirmAnswer,
      ),
    ).toEqual({ ok: false, code: "forbidden", stage: "gate", retry: false, text: "Writes are off." });
  });

  it("turns what is not an answer into a failure of the way, without raising", () => {
    for (const broken of [
      undefined,
      null,
      "ok",
      { ok: "yes" },
      { ok: true },
      { ok: true, value: {}, more: 1 },
      { ok: true, value: { token: "nope", expires: 1 } },
      { ok: false, code: "forbidden" },
      { ok: false, code: "forbidden", stage: "gate", retry: "no", text: "x" },
      { ok: false, code: "forbidden", stage: "gate", retry: false, text: "x", url: "https://leak.invalid" },
    ]) {
      expect(readAnswer(broken, readWriteConfirmAnswer)).toMatchObject({
        ok: false,
        code: "validation",
        stage: "answer",
      });
    }
  });

  it("reads the state of the gate, on and off, with the connection when it is there", () => {
    const off = { cluster: { id: cluster, name: "demo", context: "kind-demo" }, writes: { on: false } };
    const on = {
      ...off,
      writes: { on: true, namespace: "velero", since: 1700000000000 },
      connection: { supported: true, credential: "token" },
    };

    expect(readGateState(off)).toEqual(off);
    expect(readGateState(on)).toEqual(on);
    expect(readGateState({ ...off, connection: { supported: false, reason: "proxy" } })).toEqual({
      ...off,
      connection: { supported: false, reason: "proxy" },
    });
    expect(readGateState({ ...off, writes: { on: true } })).toBeUndefined();
    expect(readGateState({ ...off, writes: { on: false, namespace: "x" } })).toBeUndefined();
    expect(readGateState({ ...off, connection: { supported: false, reason: "other" } })).toBeUndefined();
    expect(readGateState({ ...off, connection: { supported: true } })).toBeUndefined();
    expect(readGateState({ ...off, cluster: { id: cluster, name: "demo" } })).toBeUndefined();
  });

  it("reads the status of a write and the answer of the server", () => {
    expect(readWriteStatus({ step: "waiting for the URL", count: 3 })).toEqual({
      step: "waiting for the URL",
      count: 3,
    });
    expect(readWriteStatus({ step: "created" })).toEqual({ step: "created" });
    expect(readWriteStatus({ step: "created", count: "3" })).toBeUndefined();
    expect(readWriteStatus({ count: 3 })).toBeUndefined();
    const status = {
      version: "v1.18.2",
      processed: "2026-09-30T10:00:00Z",
      plugins: [{ name: "velero.io/aws", kind: "ObjectStore" }],
      request: { name: "freelens-velero-abcde", uid: "uid" },
    };

    expect(readServerStatusValue(status)).toEqual(status);
    expect(readServerStatusValue({ ...status, plugins: [{ name: "velero.io/aws" }] })).toBeUndefined();
    expect(readServerStatusValue({ ...status, plugins: "none" })).toBeUndefined();
    expect(readServerStatusValue({ ...status, request: { name: "x" } })).toBeUndefined();
  });
});
