import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CredentialPluginError } from "./context-identity";
import { type DiagnosticInput, type DiagnosticOptions, DOWNLOAD_BOUNDS, runDownload } from "./diagnostic-service";
import { DiagnosticError } from "./diagnostic-transport";

import type { DiagnosticObject } from "./diagnostic-kubernetes";

const URL_OF_THE_STORE =
  "https://storage.example.invalid/bucket/backups/backup/backup-logs.gz?signature=PRIVATE-SENTINEL";

// A cluster of the test: a backup, a restore of it, their storage location, and the request the way
// creates, which the controller of the test processes at once unless the test says otherwise.
function fixture(options: Partial<DiagnosticOptions> = {}) {
  const state = {
    targetUid: "target-uid",
    current: true,
    phase: "Processed" as string,
    lost: false,
    backupName: "backup" as unknown,
    locationName: "default" as unknown,
    location: true,
    foreign: false,
    request: undefined as DiagnosticObject | undefined,
  };
  const asked: string[] = [];
  const steps: [string, number | undefined][] = [];
  const api = {
    assertCurrent: () => {
      if (!state.current) throw new DiagnosticError("target-changed");
    },
    read: vi.fn(async (kind: string, _namespace: string, name: string): Promise<DiagnosticObject> => {
      asked.push(`${kind} ${name}`);
      if (kind === "Backup")
        return {
          metadata: { name, namespace: "fixture", uid: name === "backup" ? state.targetUid : "other-uid" },
          spec: { storageLocation: state.locationName },
        };
      if (kind === "Restore")
        return {
          metadata: { name, namespace: "fixture", uid: state.targetUid },
          spec: { backupName: state.backupName },
        };
      if (kind === "BackupStorageLocation") {
        if (!state.location) throw new DiagnosticError("not-found");
        return { metadata: { name, namespace: "fixture", uid: "bsl-uid" }, spec: { objectStorage: {} } };
      }
      if (!state.request) throw new DiagnosticError("not-found");
      return {
        ...state.request,
        status:
          state.phase === "Processed" ? { phase: "Processed", downloadURL: URL_OF_THE_STORE } : { phase: state.phase },
      };
    }),
    createDownload: vi.fn(
      async (namespace: string, kind: string, targetName: string, requestName: string, requestId: string) => {
        state.request = {
          metadata: {
            namespace,
            name: requestName,
            uid: "request-uid",
            labels: { "freelensapp.io/diagnostic-request": state.foreign ? "another" : requestId },
          },
          spec: { target: { kind, name: targetName } },
        };
        if (state.lost) throw new DiagnosticError("submission-unknown");
        return state.request;
      },
    ),
    certificate: vi.fn(async () => undefined),
  };
  const close = vi.fn<() => void | Promise<void>>();
  const download = vi.fn(async (_url: string, _route: unknown, _signal: AbortSignal) => Buffer.from("synthetic log"));
  const created: { name: string; uid: string }[] = [];
  const given: DiagnosticOptions = {
    pollMs: 5,
    urlTimeoutMs: 40,
    route: vi.fn(async () => ({
      route: {
        origin: "https://storage.example.invalid",
        pathname: "/bucket/backups/backup/backup-logs.gz",
        address: "127.0.0.1",
        port: 1234,
        mode: "tunnel" as const,
      },
      close,
    })),
    download,
    onStep: (stage, count) => steps.push([stage, count]),
    onCreated: (request) => created.push(request),
    ...options,
  };
  const input = (more: Partial<DiagnosticInput> = {}): DiagnosticInput => ({
    requestId: randomUUID(),
    namespace: "fixture",
    target: "BackupLog",
    name: "backup",
    uid: "target-uid",
    ...more,
  });
  const run = (value = input(), signal = new AbortController().signal) => runDownload(api, value, signal, given);
  // The steps that were taken, each once, in the order they were first taken.
  const order = () => [...new Set(steps.map(([stage]) => stage))];

  return { state, api, asked, steps, order, close, download, created, given, input, run };
}

// How an operation ended, when it did not end with its result.
async function ended(
  operation: Promise<unknown>,
): Promise<{ code?: string; stage?: string; message?: string; verdict?: string }> {
  try {
    await operation;
  } catch (error) {
    if (!(error instanceof DiagnosticError)) throw error;
    // A verdict is said only of what the way found by itself.
    return {
      code: error.code,
      stage: error.stage,
      message: error.message,
      ...(error.verdict ? { verdict: error.verdict } : {}),
    };
  }
  throw new Error("The operation did not fail");
}

describe("the way of a DownloadRequest", () => {
  it("takes its steps in their order and gives the text, the request and the route in words, with no URL", async () => {
    const value = fixture();
    const input = value.input();
    const result = await value.run(input);

    expect(value.order()).toEqual([
      "queue",
      "target",
      "location",
      "certificate",
      "creation",
      "wait",
      "route",
      "download",
      "delivery",
    ]);
    // The target is read once more before the creation, which is a step of its own.
    expect(value.steps.map(([stage]) => stage)).toEqual([
      "queue",
      "target",
      "location",
      "certificate",
      "target",
      "creation",
      "wait",
      "route",
      "download",
      "delivery",
    ]);
    expect(result.content.toString()).toBe("synthetic log");
    expect(result.request).toEqual({ name: `backup-${input.requestId}`, uid: "request-uid" });
    expect(result.route).toEqual({ mode: "tunnel", encrypted: true, origin: "https://storage.example.invalid" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE-SENTINEL");
    expect(JSON.stringify(result)).not.toContain("backup-logs.gz");
    // One creation, of the request named after the target and the identifier, for that artifact of that target.
    expect(value.api.createDownload).toHaveBeenCalledTimes(1);
    expect(value.api.createDownload.mock.calls[0].slice(0, 5)).toEqual([
      "fixture",
      "BackupLog",
      "backup",
      `backup-${input.requestId}`,
      input.requestId,
    ]);
    expect(value.created).toEqual([result.request]);
    // The target is read before the creation and before the delivery, by its name; the request by its own.
    expect(value.asked).toEqual([
      "Backup backup",
      "BackupStorageLocation default",
      "Backup backup",
      `DownloadRequest backup-${input.requestId}`,
      "Backup backup",
    ]);
    // The URL goes to the route and to the download, and what was opened is closed, once.
    expect(value.given.route).toHaveBeenCalledTimes(1);
    expect(value.download.mock.calls[0][0]).toBe(URL_OF_THE_STORE);
    expect(value.close).toHaveBeenCalledTimes(1);
  });

  it("says of a store over plain HTTP that the connection is not encrypted", async () => {
    const value = fixture();
    const read = value.api.read.getMockImplementation();

    value.api.read.mockImplementation(async (kind: string, namespace: string, name: string) => {
      const found = await (read as NonNullable<typeof read>)(kind, namespace, name);

      return kind === "DownloadRequest"
        ? {
            ...found,
            status: {
              phase: "Processed",
              downloadURL: "http://storage.example.invalid:9000/bucket/file.gz?signature=PRIVATE-SENTINEL",
            },
          }
        : found;
    });
    expect((await value.run()).route).toEqual({
      mode: "tunnel",
      encrypted: false,
      origin: "http://storage.example.invalid:9000",
    });
  });

  it("reads the backup of a restore, and the storage location of that backup", async () => {
    const value = fixture();
    const input = value.input({ target: "RestoreLog", name: "restore" });

    await value.run(input);
    expect(value.order().slice(0, 4)).toEqual(["queue", "target", "backup", "location"]);
    expect(value.asked.slice(0, 3)).toEqual(["Restore restore", "Backup backup", "BackupStorageLocation default"]);
    expect(value.api.createDownload.mock.calls[0].slice(0, 4)).toEqual([
      "fixture",
      "RestoreLog",
      "restore",
      `restore-${input.requestId}`,
    ]);
  });

  it.each([
    ["a restore that names no backup", { backupName: undefined }, "RestoreLog", "backup"],
    ["a restore whose backup name is not a text", { backupName: ["backup"] }, "RestoreLog", "backup"],
    ["a restore whose backup name is empty", { backupName: "" }, "RestoreLog", "backup"],
    ["a backup that names no storage location", { locationName: undefined }, "BackupLog", "location"],
    ["a backup whose storage location is not there", { location: false }, "BackupLog", "location"],
    ["a restore whose backup names a location that is not there", { location: false }, "RestoreLog", "location"],
  ] as const)("ends %s as not found at that step, before any creation", async (_what, change, target, stage) => {
    const value = fixture();

    Object.assign(value.state, change);
    expect(
      await ended(value.run(value.input({ target, name: target === "RestoreLog" ? "restore" : "backup" }))),
    ).toMatchObject({ code: "not-found", stage });
    expect(value.api.createDownload).not.toHaveBeenCalled();
    expect(value.given.route).not.toHaveBeenCalled();
    expect(value.download).not.toHaveBeenCalled();
  });

  it.each([
    ["the contents of a backup", { target: "BackupContents" }],
    ["a target the API does not have", { target: "UnexpectedKind" }],
    ["a field that is not of the contract", { url: "https://example.invalid" }],
    ["an identifier that is not a text", { requestId: [randomUUID()] }],
    ["an identifier that is not one", { requestId: "0".repeat(36) }],
    ["a name that is not a text", { name: ["backup"] }],
    ["a name that is not one", { name: "Not A Name" }],
    ["a name with no room for the identifier after it", { name: "a".repeat(217) }],
    ["a namespace that is not one", { namespace: "Fixture" }],
    ["a namespace that is not a text", { namespace: 1 }],
    ["a UID that is not a text", { uid: { toString: () => "target-uid" } }],
    ["an empty UID", { uid: "" }],
  ])("refuses %s before anything is asked", async (_what, change) => {
    const value = fixture();

    expect(
      await ended(
        Promise.resolve().then(() => value.run({ ...value.input(), ...change } as unknown as DiagnosticInput)),
      ),
    ).toMatchObject({ code: "validation" });
    expect(value.asked).toEqual([]);
    expect(value.api.createDownload).not.toHaveBeenCalled();
  });

  it("takes a name as long as leaves room for the identifier of the request", async () => {
    const value = fixture();
    const name = `${"a".repeat(215)}b`;

    value.api.read.mockImplementationOnce(async () => ({
      metadata: { name, namespace: "fixture", uid: "target-uid" },
      spec: { storageLocation: "default" },
    }));
    // The read of the target is the first: the one before the creation fails on the fixture, which has no
    // such backup, and the name was taken by then.
    expect(await ended(value.run(value.input({ name })))).toMatchObject({ code: "target-changed", stage: "target" });
    expect(value.asked).toContain("BackupStorageLocation default");
  });

  it("refuses bounds beyond the ones of the way, which a test may only make shorter", async () => {
    for (const bounds of [
      { pollMs: 1001 },
      { urlTimeoutMs: 30_001 },
      { totalMs: 120_001 },
      { closeMs: 5001 },
      { pollMs: 0 },
    ]) {
      const value = fixture(bounds);

      expect([bounds, await ended(Promise.resolve().then(() => value.run()))]).toEqual([
        bounds,
        expect.objectContaining({ code: "validation" }),
      ]);
      expect(value.asked).toEqual([]);
    }
  });

  it("stops before the creation when the target is another object, or the connection changed", async () => {
    const value = fixture();

    value.state.targetUid = "recreated-uid";
    expect(await ended(value.run())).toMatchObject({ code: "target-changed", stage: "target", verdict: "replaced" });
    value.state.targetUid = "target-uid";
    value.state.current = false;
    // A connection that changed is not an object that took the place of the target: no verdict says so.
    const changed = await ended(value.run());

    expect(changed).toMatchObject({ code: "target-changed", stage: "target" });
    expect(changed).not.toHaveProperty("verdict");
    expect(value.api.createDownload).not.toHaveBeenCalled();
  });

  it("reads the target once more before the creation, and creates nothing for one that changed since the first read", async () => {
    const value = fixture();

    // The certificate is read after the location: the target is made again while it is.
    value.api.certificate.mockImplementationOnce(async () => {
      value.state.targetUid = "recreated-uid";
      return undefined;
    });
    expect(await ended(value.run())).toMatchObject({ code: "target-changed", stage: "target", verdict: "replaced" });
    expect(value.order()).toEqual(["queue", "target", "location", "certificate"]);
    expect(value.api.createDownload).not.toHaveBeenCalled();
  });

  it("delivers nothing of a target that changed while the bytes arrived", async () => {
    const value = fixture();

    value.download.mockImplementationOnce(async () => {
      value.state.targetUid = "recreated-uid";
      return Buffer.from("text of the one before");
    });
    expect(await ended(value.run())).toMatchObject({ code: "target-changed", stage: "delivery", verdict: "replaced" });
    expect(value.close).toHaveBeenCalledTimes(1);
  });

  it("takes a URL from no object that is not the request it created", async () => {
    for (const change of [
      (request: DiagnosticObject) => ({ ...request, metadata: { ...request.metadata, uid: "another-uid" } }),
      (request: DiagnosticObject) => ({
        ...request,
        metadata: { ...request.metadata, labels: { "freelensapp.io/diagnostic-request": "another" } },
      }),
      (request: DiagnosticObject) => ({ ...request, metadata: { ...request.metadata, labels: undefined } }),
      (request: DiagnosticObject) => ({ ...request, metadata: { ...request.metadata, namespace: "another" } }),
      (request: DiagnosticObject) => ({ ...request, spec: { target: { kind: "BackupResults", name: "backup" } } }),
      (request: DiagnosticObject) => ({ ...request, spec: { target: { kind: "BackupLog", name: "another" } } }),
      (request: DiagnosticObject) => ({ ...request, spec: undefined }),
    ]) {
      const value = fixture();
      const read = value.api.read.getMockImplementation();

      if (!read) throw new Error("Missing API fixture implementation");
      value.api.read.mockImplementation(async (kind, namespace, name) => {
        const found = await read(kind, namespace, name);

        return kind === "DownloadRequest" ? (change(found) as DiagnosticObject) : found;
      });
      expect(await ended(value.run())).toMatchObject({ code: "target-changed", stage: "wait", verdict: "another" });
      expect(value.given.route).not.toHaveBeenCalled();
      expect(value.download).not.toHaveBeenCalled();
    }
  });

  it("tells what the request said from what a read of it ended with: the same code, and no verdict", async () => {
    // The cluster does not answer a read of the request, answers it with what is not named, or its
    // connection changed: none of them is a request Velero did not sign, said that failed, or replaced.
    for (const code of ["deadline", "request-failed", "target-changed", "forbidden", "not-found"] as const) {
      const value = fixture();
      const read = value.api.read.getMockImplementation();

      if (!read) throw new Error("Missing API fixture implementation");
      value.api.read.mockImplementation(async (kind, namespace, name) => {
        if (kind === "DownloadRequest") throw new DiagnosticError(code);
        return read(kind, namespace, name);
      });
      const failure = await ended(value.run());

      expect([code, failure]).toEqual([code, { code, stage: "wait", message: `Diagnostic operation failed: ${code}` }]);
      expect(value.given.route).not.toHaveBeenCalled();
    }
  });

  it("does not write on what was raised: an error two operations share says the step of each", async () => {
    // The adapter gives one error to every request that waited for the same run of the plugin.
    const shared = new CredentialPluginError("/usr/local/bin/kubelogin", "failed");
    const first = fixture();
    const second = fixture();

    first.api.read.mockRejectedValueOnce(shared);
    second.api.certificate.mockRejectedValueOnce(shared);
    const failures = [await ended(first.run()), await ended(second.run())];

    expect(failures).toMatchObject([
      { code: "request-failed", stage: "target" },
      { code: "request-failed", stage: "certificate" },
    ]);
    expect(shared.stage).toBeUndefined();
    // The command and the reason of the plugin go with each.
    second.api.certificate.mockRejectedValueOnce(shared);
    const plugin = await second.run().catch((error: unknown) => error);

    expect(plugin).toBeInstanceOf(CredentialPluginError);
    expect(plugin).not.toBe(shared);
    expect(plugin).toMatchObject({ command: "kubelogin", reason: "failed", stage: "certificate" });
    const one = new DiagnosticError("forbidden");

    first.api.read.mockRejectedValueOnce(one);
    expect(await ended(first.run())).toMatchObject({ code: "forbidden", stage: "target" });
    expect(one.stage).toBeUndefined();
  });

  it("keeps a request of that name that is not this one, and uses nothing of it", async () => {
    const value = fixture();

    value.api.createDownload.mockRejectedValueOnce(new DiagnosticError("conflict"));
    expect(await ended(value.run())).toMatchObject({ code: "conflict", stage: "creation" });
    // The answer of the cluster is a request, and not the one that was asked.
    value.state.foreign = true;
    expect(await ended(value.run())).toMatchObject({ code: "conflict", stage: "creation" });
    // An object without a UID is no request the wait could know again.
    value.state.foreign = false;
    value.api.createDownload.mockImplementationOnce(async (namespace, kind, targetName, requestName, requestId) => ({
      metadata: {
        namespace,
        name: requestName,
        uid: "",
        labels: { "freelensapp.io/diagnostic-request": requestId },
      },
      spec: { target: { kind, name: targetName } },
    }));
    expect(await ended(value.run())).toMatchObject({ code: "conflict", stage: "creation" });
    expect(value.download).not.toHaveBeenCalled();
    // What was there is read and never changed: one creation was asked for each run, and nothing else.
    expect(value.api.createDownload).toHaveBeenCalledTimes(3);
  });

  it("says that the creation is not known when what was raised while the request was created is not a code", async () => {
    const value = fixture();

    value.api.createDownload.mockRejectedValueOnce(new TypeError("an object the adapter did not expect"));
    expect(await ended(value.run())).toMatchObject({ code: "submission-unknown", stage: "creation" });
    // Anywhere else, what is not a code is a failure the way does not name.
    value.api.read.mockRejectedValueOnce(new TypeError("an object the adapter did not expect"));
    expect(await ended(value.run())).toMatchObject({ code: "request-failed", stage: "target" });
  });

  it("finds by its name a request whose creation was not answered, and never creates it a second time", async () => {
    const value = fixture();

    value.state.lost = true;
    const input = value.input();
    const result = await value.run(input);

    expect(result.request).toEqual({ name: `backup-${input.requestId}`, uid: "request-uid" });
    expect(value.api.createDownload).toHaveBeenCalledTimes(1);
    expect(value.asked.filter((read) => read.startsWith("DownloadRequest"))).toHaveLength(2);
  });

  it("says that the creation is not known when the request is not found after it, and when it is another's", async () => {
    const value = fixture();

    value.state.lost = true;
    value.api.createDownload.mockImplementationOnce(async () => {
      throw new DiagnosticError("submission-unknown");
    });
    expect(await ended(value.run())).toMatchObject({ code: "submission-unknown", stage: "creation" });
    expect(value.api.createDownload).toHaveBeenCalledTimes(1);
    value.state.foreign = true;
    expect(await ended(value.run())).toMatchObject({ code: "conflict", stage: "creation" });
    expect(value.api.createDownload).toHaveBeenCalledTimes(2);
    expect(value.download).not.toHaveBeenCalled();
  });

  it("waits for the URL for as long as its bound, and ends without one, without the words of the controller", async () => {
    const value = fixture();

    value.state.phase = "New";
    const failure = await ended(value.run());

    expect(failure).toEqual({
      code: "deadline",
      stage: "wait",
      message: "Diagnostic operation failed: deadline",
      verdict: "unsigned",
    });
    expect(value.download).not.toHaveBeenCalled();
    expect(value.given.route).not.toHaveBeenCalled();
    // Read again while it waits, and the seconds it waited are told: how often, the test of its own bounds
    // says on a clock of the test.
    expect(value.asked.filter((read) => read.startsWith("DownloadRequest")).length).toBeGreaterThan(1);
    expect(value.steps.filter(([stage]) => stage === "wait").every(([, count]) => count === 0)).toBe(true);
    // A request with no phase at all is one the controller has not taken: the same wait.
    value.state.phase = undefined as unknown as string;
    expect(await ended(value.run())).toMatchObject({ code: "deadline", stage: "wait", verdict: "unsigned" });
  });

  it("reads the request every 250 milliseconds for thirty seconds, and ends the whole operation at 120, on its own bounds", async () => {
    expect(DOWNLOAD_BOUNDS).toEqual({ pollMs: 250, urlTimeoutMs: 30_000, totalMs: 120_000, closeMs: 5_000 });
    vi.useFakeTimers();
    try {
      // The bounds of the way itself: the test gives none.
      const value = fixture({ pollMs: undefined, urlTimeoutMs: undefined });

      value.state.phase = "New";
      const pending = ended(value.run());
      const polls = () => value.asked.filter((read) => read.startsWith("DownloadRequest")).length;

      await vi.advanceTimersByTimeAsync(0);
      expect(polls()).toBe(1);
      await vi.advanceTimersByTimeAsync(249);
      expect(polls()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(polls()).toBe(2);
      await vi.advanceTimersByTimeAsync(9_750);
      expect(polls()).toBe(41);
      // The seconds waited are told as they pass.
      expect(value.steps.filter(([stage]) => stage === "wait").at(-1)).toEqual(["wait", 10]);
      await vi.advanceTimersByTimeAsync(19_999);
      expect(value.given.route).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toMatchObject({ code: "deadline", stage: "wait", verdict: "unsigned" });
      expect(polls()).toBe(121);
      // The whole operation: a download that does not end is stopped at 120 seconds, and not before.
      const whole = fixture({ pollMs: undefined, urlTimeoutMs: undefined });
      let stopped = false;

      whole.download.mockImplementationOnce(
        (_url, _route, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                stopped = true;
                reject(new DiagnosticError("cancelled"));
              },
              { once: true },
            );
          }),
      );
      const running = ended(whole.run());

      await vi.advanceTimersByTimeAsync(119_999);
      expect(stopped).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await running).toMatchObject({ code: "deadline", stage: "download", verdict: "whole" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends the wait at a phase Failed, which the main branch of Velero has, and at an expiration that passed", async () => {
    const value = fixture();

    value.state.phase = "Failed";
    expect(await ended(value.run())).toMatchObject({ code: "request-failed", stage: "wait", verdict: "failed" });
    const read = value.api.read.getMockImplementation();

    if (!read) throw new Error("Missing API fixture implementation");
    for (const expiration of ["2000-01-01T00:00:00Z", "not a time"]) {
      value.api.read.mockImplementation(async (kind, namespace, name) => {
        const found = await read(kind, namespace, name);

        return kind === "DownloadRequest"
          ? { ...found, status: { phase: "Processed", expiration, downloadURL: URL_OF_THE_STORE } }
          : found;
      });
      expect([expiration, await ended(value.run())]).toEqual([
        expiration,
        expect.objectContaining({ code: "deadline", stage: "wait", verdict: "expired" }),
      ]);
    }
    expect(value.download).not.toHaveBeenCalled();
  });

  it("ends the whole operation at its bound, wherever it is, and closes what it opened", async () => {
    const value = fixture({ totalMs: 60 });

    value.download.mockImplementationOnce(
      (_url, _route, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DiagnosticError("cancelled")), { once: true });
        }),
    );
    // The bound of the whole operation is told from the one of a step: the wait for a URL has its own.
    expect(await ended(value.run())).toMatchObject({ code: "deadline", stage: "download", verdict: "whole" });
    expect(value.close).toHaveBeenCalledTimes(1);
    const waiting = fixture();

    waiting.state.phase = "New";
    expect(await ended(waiting.run())).toMatchObject({ code: "deadline", stage: "wait", verdict: "unsigned" });
  });

  it("leaves behind a route and a download that do not stop when they are told to, and closes a route given late", async () => {
    // A route that ignores the signal: the operation ends at its bound all the same, and gives its place back.
    const lateClose = vi.fn();
    let give: (value: Awaited<ReturnType<DiagnosticOptions["route"]>>) => void = () => undefined;
    const deaf = fixture({
      totalMs: 60,
      route: vi.fn(
        () =>
          new Promise<Awaited<ReturnType<DiagnosticOptions["route"]>>>((resolve) => {
            give = resolve;
          }),
      ),
    });

    expect(await ended(deaf.run())).toMatchObject({ code: "deadline", stage: "route", verdict: "whole" });
    expect(deaf.download).not.toHaveBeenCalled();
    // What it gives after the operation ended is closed, and used for nothing.
    give({
      route: {
        origin: "https://storage.example.invalid",
        pathname: "/",
        address: "127.0.0.1",
        port: 1,
        mode: "tunnel",
      },
      close: lateClose,
    });
    await vi.waitFor(() => expect(lateClose).toHaveBeenCalledTimes(1));
    // A download that ignores the signal, cancelled by who asked for it.
    const controller = new AbortController();
    const slow = fixture();

    slow.download.mockImplementationOnce(() => new Promise<never>(() => undefined));
    const pending = ended(slow.run(slow.input(), controller.signal));

    await vi.waitFor(() => expect(slow.download).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await pending).toMatchObject({ code: "cancelled", stage: "download" });
    expect(slow.close).toHaveBeenCalledTimes(1);
    // Both places are free: two operations run at once after them.
    const after = [fixture(), fixture()];

    expect((await Promise.all(after.map((value) => value.run()))).map((result) => result.content.toString())).toEqual([
      "synthetic log",
      "synthetic log",
    ]);
  });

  it("delivers nothing of an operation that was cancelled while what it opened was closed", async () => {
    const controller = new AbortController();
    let closed: () => void = () => undefined;
    const value = fixture();

    value.close.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          closed = resolve;
        }),
    );
    const pending = ended(value.run(value.input(), controller.signal));

    await vi.waitFor(() => expect(value.close).toHaveBeenCalledTimes(1));
    // The bytes arrived and the target was read again: only the route is still closing.
    expect(value.order().at(-1)).toBe("delivery");
    controller.abort();
    closed();
    expect(await pending).toMatchObject({ code: "cancelled", stage: "release" });
  });

  it("says that the whole operation ended while the request was created, when its bound is reached there", async () => {
    const value = fixture({ totalMs: 60 });

    // A creation the cluster does not answer: the adapter ends it when the operation is stopped.
    value.api.createDownload.mockImplementationOnce(
      (...given: unknown[]) =>
        new Promise<DiagnosticObject>((_resolve, reject) => {
          (given[5] as AbortSignal).addEventListener("abort", () => reject(new DiagnosticError("cancelled")), {
            once: true,
          });
        }),
    );
    expect(await ended(value.run())).toMatchObject({ code: "deadline", stage: "creation", verdict: "whole" });
    expect(value.api.createDownload).toHaveBeenCalledTimes(1);
  });

  it("is cancelled while it waits for the URL, leaves the request where it is and opens no route", async () => {
    const value = fixture({ urlTimeoutMs: 1000 });
    const controller = new AbortController();

    value.state.phase = "New";
    const pending = ended(value.run(value.input(), controller.signal));

    await vi.waitFor(() => expect(value.created).toHaveLength(1));
    controller.abort();
    expect(await pending).toMatchObject({ code: "cancelled", stage: "wait" });
    expect(value.given.route).not.toHaveBeenCalled();
    expect(value.download).not.toHaveBeenCalled();
  });

  it("ends at once when it is cancelled between two reads, without waiting for the next", async () => {
    vi.useFakeTimers();
    try {
      // A second between two reads, the longest a way may be given.
      const value = fixture({ pollMs: 1000, urlTimeoutMs: 30_000 });
      const controller = new AbortController();
      let outcome: unknown;

      value.state.phase = "New";
      ended(value.run(value.input(), controller.signal)).then((failure) => {
        outcome = failure;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(value.created).toHaveLength(1);
      controller.abort();
      // The clock of the test did not move: the wait itself ended.
      await vi.advanceTimersByTimeAsync(0);
      expect(outcome).toMatchObject({ code: "cancelled", stage: "wait" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("says as a cancellation whatever a read raises once the operation was stopped", async () => {
    const value = fixture({ urlTimeoutMs: 30_000 });
    const controller = new AbortController();
    const read = value.api.read.getMockImplementation();
    let polls = 0;

    if (!read) throw new Error("Missing API fixture implementation");
    value.state.phase = "New";
    // The second read of the request does not end until the operation is stopped, and then says that its
    // connection was lost, as a socket that was taken away does.
    value.api.read.mockImplementation(async (kind: string, namespace: string, name: string) => {
      if (kind !== "DownloadRequest") return read(kind, namespace, name);
      polls += 1;
      if (polls < 2) return read(kind, namespace, name);
      await new Promise<void>((resolve) => {
        controller.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new DiagnosticError("transport-unreachable");
    });
    const pending = ended(value.run(value.input(), controller.signal));

    await vi.waitFor(() => expect(polls).toBe(2));
    controller.abort();
    // What the read raised is not what is said: the operation was stopped.
    expect(await pending).toMatchObject({ code: "cancelled", stage: "wait" });
  });

  it("is cancelled while the bytes arrive, and closes what it opened", async () => {
    const value = fixture();
    const controller = new AbortController();

    value.download.mockImplementationOnce(
      (_url, _route, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DiagnosticError("cancelled")), { once: true });
          controller.abort();
        }),
    );
    expect(await ended(value.run(value.input(), controller.signal))).toMatchObject({
      code: "cancelled",
      stage: "download",
    });
    expect(value.close).toHaveBeenCalledTimes(1);
  });

  it("does not start for a signal that was aborted before", async () => {
    const value = fixture();
    const controller = new AbortController();

    controller.abort();
    expect(await ended(value.run(value.input(), controller.signal))).toMatchObject({
      code: "cancelled",
      stage: "queue",
    });
    expect(value.asked).toEqual([]);
  });

  it("runs two operations at once in the process, and the third waits its turn or is cancelled while it waits", async () => {
    const first = fixture({ urlTimeoutMs: 1000 });
    const second = fixture({ urlTimeoutMs: 1000 });
    const third = fixture({ urlTimeoutMs: 1000 });
    const fourth = fixture();
    const controllers = [new AbortController(), new AbortController(), new AbortController()];

    for (const value of [first, second, third]) value.state.phase = "New";
    const results = [first, second, third].map((value, index) =>
      ended(value.run(value.input(), controllers[index].signal)),
    );
    const last = fourth.run();

    await vi.waitFor(() => {
      expect(first.created).toHaveLength(1);
      expect(second.created).toHaveLength(1);
    });
    // The two others wait: nothing of them was asked of the cluster.
    expect(third.order()).toEqual(["queue"]);
    expect(third.asked).toEqual([]);
    expect(fourth.asked).toEqual([]);
    // Cancelled while it waits, the third leaves the queue and never asks; the fourth takes the place
    // the first leaves.
    controllers[2].abort();
    expect(await results[2]).toMatchObject({ code: "cancelled", stage: "queue" });
    expect(third.asked).toEqual([]);
    controllers[0].abort();
    expect(await results[0]).toMatchObject({ code: "cancelled", stage: "wait" });
    expect((await last).content.toString()).toBe("synthetic log");
    controllers[1].abort();
    expect(await results[1]).toMatchObject({ code: "cancelled", stage: "wait" });
  });

  it("says that a route did not close, without the words of what raised, and gives its place back", async () => {
    const value = fixture();

    value.close.mockImplementationOnce(() => {
      throw new Error("PRIVATE-SENTINEL");
    });
    expect(await ended(value.run())).toEqual({
      code: "transport-unreachable",
      stage: "release",
      message: "Diagnostic operation failed: transport-unreachable",
    });
    // The failure of the operation is the one that is said, when there is one: the close adds nothing to it.
    value.close.mockImplementationOnce(() => {
      throw new Error("PRIVATE-SENTINEL");
    });
    value.download.mockRejectedValueOnce(new DiagnosticError("artifact-missing"));
    expect(await ended(value.run())).toMatchObject({ code: "artifact-missing", stage: "download" });
  });

  it("does not wait for a route that never closes beyond its bound, and does not keep its place for it", async () => {
    const stuck = [fixture({ closeMs: 30 }), fixture({ closeMs: 30 })];
    const after = fixture();

    for (const value of stuck) value.close.mockImplementation(() => new Promise<void>(() => undefined));
    const started = Date.now();
    const failures = await Promise.all(stuck.map((value) => ended(value.run())));

    expect(failures).toEqual([
      expect.objectContaining({ code: "transport-unreachable", stage: "release" }),
      expect.objectContaining({ code: "transport-unreachable", stage: "release" }),
    ]);
    expect(Date.now() - started).toBeLessThan(2000);
    // Both places are free again: an operation after them runs.
    expect((await after.run()).content.toString()).toBe("synthetic log");
  });

  it("says every way of ending by its code alone: nothing of the URL, of the store or of what raised is in it", async () => {
    const value = fixture();

    value.download.mockRejectedValueOnce(new Error(`connect ECONNREFUSED ${URL_OF_THE_STORE}`));
    const failure = await ended(value.run());

    expect(failure).toEqual({
      code: "request-failed",
      stage: "download",
      message: "Diagnostic operation failed: request-failed",
    });
    (value.given.route as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new DiagnosticError("destination-denied"));
    expect(await ended(value.run())).toMatchObject({ code: "destination-denied", stage: "route" });
    value.api.certificate.mockRejectedValueOnce(new DiagnosticError("tls-invalid"));
    expect(await ended(value.run())).toMatchObject({ code: "tls-invalid", stage: "certificate" });
    // A step that already says where it ended keeps what it says.
    value.api.certificate.mockRejectedValueOnce(new DiagnosticError("forbidden", "secret"));
    expect(await ended(value.run())).toMatchObject({ code: "forbidden", stage: "secret" });
  });
});
