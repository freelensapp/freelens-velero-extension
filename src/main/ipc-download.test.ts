// The procedures of a DownloadRequest, as the frames call them: the confirmation of one artifact of one
// target, the run that joins the one in flight, the text held by the main process and given in pages to
// the frame that asked for it, and the words of every way it ends.

import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CHANNELS, readAnswer, readArtifactPage, readArtifactValue } from "../common/ipc";
import { ArtifactHolder } from "./artifact-holder";
import { CredentialPluginError } from "./context-identity";
import { DiagnosticError } from "./diagnostic-transport";
import { downloadFailureOf, registerHandlers } from "./ipc";
import { WriteGate } from "./write-gate";

import type { DiagnosticObject } from "./diagnostic-kubernetes";
import type { IpcEvent, Registrar } from "./ipc";
import type { CatalogEntry } from "./write-gate";

const FRAME_A: IpcEvent = {
  senderFrame: { url: "https://cluster-a.renderer.freelens.app:1234/" },
  processId: 1,
  frameId: 4,
};
// Another frame of the same cluster: the same window can hold it.
const FRAME_A2: IpcEvent = { ...FRAME_A, frameId: 5 };
const FRAME_B: IpcEvent = {
  senderFrame: { url: "https://cluster-b.renderer.freelens.app:1234/" },
  processId: 1,
  frameId: 9,
};
const SIGNED =
  "https://storage.example.invalid/bucket/backups/nightly/nightly-logs.gz?X-Amz-Signature=PRIVATE-SENTINEL";
const TARGET = { kind: "Backup" as const, name: "nightly", uid: "backup-uid" };
const LOG = 'time="2026-09-30T10:00:00Z" level=info msg="Backup completed"';

function fixture(options: { route?: boolean; urlTimeoutMs?: number } = {}) {
  const catalog: CatalogEntry[] = [
    { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a" },
    { id: "cluster-b", name: "other", kubeConfigPath: "/synthetic/b", contextName: "kind-b" },
  ];
  const handlers = new Map<string, (event: IpcEvent, payload: unknown) => Promise<unknown>>();
  const broadcasts: unknown[] = [];
  const registrar: Registrar = {
    handle: (channel, handler) => handlers.set(channel, handler),
    broadcast: (channel, ...args) => broadcasts.push([channel, ...args]),
  };
  // The requests the cluster of the test holds, by their name, and the phase its controller gives them.
  const state = { phase: "Processed" as string, requests: new Map<string, DiagnosticObject>() };
  const adapter = {
    assertCurrent: vi.fn(),
    read: vi.fn(async (kind: string, namespace: string, name: string): Promise<DiagnosticObject> => {
      if (kind === "Backup")
        return { metadata: { name, namespace, uid: "backup-uid" }, spec: { storageLocation: "default" } };
      if (kind === "BackupStorageLocation")
        return { metadata: { name, namespace, uid: "bsl-uid" }, spec: { objectStorage: {} } };
      const request = state.requests.get(name);

      if (!request) throw new DiagnosticError("not-found");
      return {
        ...request,
        status: state.phase === "Processed" ? { phase: "Processed", downloadURL: SIGNED } : { phase: state.phase },
      };
    }),
    createDownload: vi.fn(
      async (namespace: string, kind: string, targetName: string, requestName: string, requestId: string) => {
        const request = {
          metadata: {
            namespace,
            name: requestName,
            uid: "request-uid",
            labels: { "freelensapp.io/diagnostic-request": requestId },
          },
          spec: { target: { kind, name: targetName } },
        };

        state.requests.set(requestName, request);
        return request;
      },
    ),
    certificate: vi.fn(async () => undefined),
  };
  const gate = new WriteGate({
    catalog: () => catalog,
    connection: () => ({ supported: true, credential: "token" }),
    adapter: () => adapter as never,
  });
  const holder = new ArtifactHolder();
  const close = vi.fn();
  const download = vi.fn(async (_url: string, _route: unknown, _signal: AbortSignal) => Buffer.from(LOG));
  const route = vi.fn(async () => ({
    route: {
      origin: "https://storage.example.invalid",
      pathname: "/bucket/backups/nightly/nightly-logs.gz",
      address: "127.0.0.1",
      port: 1234,
      mode: "tunnel" as const,
    },
    close,
  }));
  const dispose = registerHandlers(registrar, {
    catalog: () => catalog,
    gate,
    pollMs: 5,
    holder,
    ...(options.route === false ? {} : { route }),
    download: { download, pollMs: 5, urlTimeoutMs: options.urlTimeoutMs ?? 80 },
  });
  const call = (channel: string, event: IpcEvent, payload: unknown) => {
    const handler = handlers.get(channel);

    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler(event, payload) as Promise<{
      ok: boolean;
      value?: unknown;
      code?: string;
      stage?: string;
      text?: string;
    }>;
  };
  const enable = (event = FRAME_A) =>
    call(CHANNELS.gateEnable, event, {
      cluster: "cluster-a",
      namespace: "velero",
      confirmation: { context: "kind-a", namespace: "velero" },
    });
  // The confirmation of one artifact of the target, and the run it allows.
  const confirm = async (artifact = "BackupLog", event = FRAME_A) => {
    const confirmed = await call(CHANNELS.writeConfirm, event, {
      cluster: "cluster-a",
      namespace: "velero",
      kind: "DownloadRequest",
      target: TARGET,
      artifact,
    });

    return (confirmed.value as { token: string } | undefined)?.token ?? "";
  };
  const run = (token: string, request = randomUUID(), artifact = "BackupLog", event = FRAME_A) =>
    call(CHANNELS.writeRun, event, {
      cluster: "cluster-a",
      namespace: "velero",
      kind: "DownloadRequest",
      target: TARGET,
      artifact,
      token,
      request,
    });

  return {
    catalog,
    handlers,
    broadcasts,
    state,
    adapter,
    gate,
    holder,
    close,
    download,
    route,
    call,
    enable,
    confirm,
    run,
    dispose,
  };
}

describe("the procedures of a DownloadRequest", () => {
  it("registers the procedures of the text of an artifact beside the ones of the gate", () => {
    const { handlers, dispose } = fixture();

    expect([...handlers.keys()].sort()).toEqual(
      [
        CHANNELS.gateState,
        CHANNELS.gateEnable,
        CHANNELS.gateDisable,
        CHANNELS.writeConfirm,
        CHANNELS.writeRun,
        CHANNELS.writeStatus,
        CHANNELS.writeCancel,
        CHANNELS.artifactPage,
        CHANNELS.artifactRelease,
      ].sort(),
    );
    dispose();
  });

  it("creates nothing for an artifact while the main process has no route to its store, and takes no token for it", async () => {
    const { enable, confirm, run, adapter, gate, dispose } = fixture({ route: false });

    await enable();
    const token = await confirm();
    const request = randomUUID();

    await expect(run(token, request)).resolves.toMatchObject({ ok: false, code: "validation", stage: "kind" });
    expect(adapter.createDownload).not.toHaveBeenCalled();
    expect(adapter.read).not.toHaveBeenCalled();
    // The confirmation was not spent: the gate still holds it.
    expect(
      gate.take("cluster-a:1:4", "cluster-a", "velero", "DownloadRequest", TARGET, token, request, "BackupLog"),
    ).toMatchObject({
      ok: true,
    });
    dispose();
  });

  it("runs the way for the artifact that was confirmed, and answers the request, the size, the pages and the route in words", async () => {
    const { enable, confirm, run, call, adapter, close, dispose } = fixture();

    await enable();
    const request = randomUUID();
    const answer = await run(await confirm(), request);

    expect(answer).toEqual({
      ok: true,
      value: {
        request: { name: `nightly-${request}`, uid: "request-uid" },
        size: Buffer.byteLength(LOG),
        pages: 1,
        route: { mode: "tunnel", encrypted: true, origin: "https://storage.example.invalid" },
      },
    });
    // What the views read of it is what was answered: it is of the contract.
    expect(readAnswer(answer, readArtifactValue)).toEqual(answer);
    expect(adapter.createDownload).toHaveBeenCalledTimes(1);
    expect(adapter.createDownload.mock.calls[0].slice(0, 5)).toEqual([
      "velero",
      "BackupLog",
      "nightly",
      `nightly-${request}`,
      request,
    ]);
    expect(close).toHaveBeenCalledTimes(1);
    await expect(call(CHANNELS.writeStatus, FRAME_A, { cluster: "cluster-a", request })).resolves.toEqual({
      ok: true,
      value: { step: "done" },
    });
    // The text is asked page by page, by the frame it is held for.
    const page = await call(CHANNELS.artifactPage, FRAME_A, { cluster: "cluster-a", request, page: 0 });

    expect(page).toEqual({
      ok: true,
      value: { page: 0, pages: 1, text: LOG },
    });
    expect(readAnswer(page, readArtifactPage, true)).toEqual(page);
    await expect(
      call(CHANNELS.artifactPage, FRAME_A, { cluster: "cluster-a", request, page: 1 }),
    ).resolves.toMatchObject({
      ok: false,
      code: "not-found",
      stage: "delivery",
    });
    dispose();
  });

  it("puts the signed URL in no answer, no status and no failure", async () => {
    const { enable, confirm, run, call, download, dispose } = fixture();
    const said: unknown[] = [];

    await enable();
    const request = randomUUID();

    said.push(await run(await confirm(), request));
    said.push(await call(CHANNELS.writeStatus, FRAME_A, { cluster: "cluster-a", request }));
    said.push(await call(CHANNELS.artifactPage, FRAME_A, { cluster: "cluster-a", request, page: 9 }));
    download.mockRejectedValueOnce(new Error(`getaddrinfo ENOTFOUND ${SIGNED}`));
    said.push(await run(await confirm()));
    download.mockRejectedValueOnce(new DiagnosticError("artifact-missing"));
    said.push(await run(await confirm()));
    expect(JSON.stringify(said)).not.toMatch(/PRIVATE-SENTINEL|X-Amz|nightly-logs\.gz|ENOTFOUND/);
    expect(said[3]).toMatchObject({ ok: false, code: "request-failed", stage: "download" });
    expect(said[4]).toMatchObject({ ok: false, code: "artifact-missing", stage: "download" });
    dispose();
  });

  it("refuses the contents of a backup, and every target that is not one of the eight, before the gate is looked at", async () => {
    const { enable, confirm, run, call, adapter, gate, dispose } = fixture();
    const take = vi.spyOn(gate, "take");
    const confirmation = vi.spyOn(gate, "confirm");

    await enable();
    const token = await confirm();

    confirmation.mockClear();
    for (const artifact of ["BackupContents", "BackupItemOperations", "CSIBackupVolumeSnapshots", "RestoreLog", ""]) {
      await expect(run(token, randomUUID(), artifact)).resolves.toMatchObject({
        ok: false,
        code: "validation",
        stage: "request",
      });
      await expect(
        call(CHANNELS.writeConfirm, FRAME_A, {
          cluster: "cluster-a",
          namespace: "velero",
          kind: "DownloadRequest",
          target: TARGET,
          artifact,
        }),
      ).resolves.toMatchObject({ ok: false, code: "validation", stage: "request" });
    }
    expect(take).not.toHaveBeenCalled();
    expect(confirmation).not.toHaveBeenCalled();
    expect(adapter.createDownload).not.toHaveBeenCalled();
    dispose();
  });

  it("does not run the results with the confirmation of the log, and leaves that confirmation good for the log", async () => {
    const { enable, confirm, run, adapter, dispose } = fixture();

    await enable();
    const token = await confirm("BackupLog");

    await expect(run(token, randomUUID(), "BackupResults")).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "confirmation",
    });
    expect(adapter.createDownload).not.toHaveBeenCalled();
    await expect(run(token)).resolves.toMatchObject({ ok: true });
    expect(adapter.createDownload.mock.calls[0][1]).toBe("BackupLog");
    dispose();
  });

  it("joins a request that is sent again while it runs, and creates one request for the two", async () => {
    const { enable, confirm, run, adapter, state, call, dispose } = fixture();

    await enable();
    state.phase = "New";
    const token = await confirm();
    const request = randomUUID();
    const first = run(token, request);
    const second = run(token, request);

    await vi.waitFor(() => expect(adapter.createDownload).toHaveBeenCalledTimes(1));
    // The same identifier from another frame, or with another token, is not the request that runs.
    await expect(run(token, request, "BackupLog", FRAME_A2)).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "request",
    });
    await expect(run(await confirm(), request)).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "request",
    });
    await expect(call(CHANNELS.writeStatus, FRAME_A, { cluster: "cluster-a", request })).resolves.toMatchObject({
      ok: true,
      value: { step: "wait", count: 0 },
    });
    state.phase = "Processed";
    const answers = await Promise.all([first, second]);

    expect(answers[0]).toMatchObject({ ok: true, value: { request: { name: `nightly-${request}` } } });
    expect(answers[1]).toBe(answers[0]);
    expect(adapter.createDownload).toHaveBeenCalledTimes(1);
    // Once it ended its identifier and its token are spent: a second command is a second confirmation.
    await expect(run(token, request)).resolves.toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    expect(adapter.createDownload).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("gives the pages of a text to the frame it is held for, and to no other frame and no other cluster", async () => {
    const { enable, confirm, run, call, holder, dispose } = fixture();

    await enable();
    const request = randomUUID();

    await run(await confirm(), request);
    await expect(
      call(CHANNELS.artifactPage, FRAME_A2, { cluster: "cluster-a", request, page: 0 }),
    ).resolves.toMatchObject({
      ok: false,
      code: "not-found",
    });
    await expect(
      call(CHANNELS.artifactPage, FRAME_B, { cluster: "cluster-a", request, page: 0 }),
    ).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "frame",
    });
    // Another frame does not let it go either.
    await expect(call(CHANNELS.artifactRelease, FRAME_A2, { cluster: "cluster-a", request })).resolves.toEqual({
      ok: true,
      value: null,
    });
    expect(holder.size).toBe(1);
    await expect(call(CHANNELS.artifactRelease, FRAME_A, { cluster: "cluster-a", request })).resolves.toEqual({
      ok: true,
      value: null,
    });
    expect(holder.size).toBe(0);
    await expect(
      call(CHANNELS.artifactPage, FRAME_A, { cluster: "cluster-a", request, page: 0 }),
    ).resolves.toMatchObject({
      ok: false,
      code: "not-found",
      stage: "delivery",
    });
    dispose();
  });

  it("lets the texts of a cluster go when its gate changes for a reason of its own, and all of them when it is released", async () => {
    const { enable, confirm, run, catalog, gate, holder, broadcasts, dispose } = fixture();

    await enable();
    await run(await confirm());
    expect(holder.size).toBe(1);
    // The entry of the cluster points at another file: writes go off, the frames are told, the text goes.
    catalog[0] = { ...catalog[0], kubeConfigPath: "/synthetic/other" };
    gate.reconcile();
    expect(broadcasts).toEqual([[CHANNELS.gateChanged, { cluster: "cluster-a" }]]);
    expect(holder.size).toBe(0);
    await enable();
    await run(await confirm());
    expect(holder.size).toBe(1);
    dispose();
    expect(holder.size).toBe(0);
  });

  it("says in the words of each way how a download ended, with the name of the request once it is created", async () => {
    const { enable, confirm, run, adapter, state, download, dispose } = fixture();

    await enable();
    const request = randomUUID();

    adapter.createDownload.mockRejectedValueOnce(new DiagnosticError("forbidden"));
    await expect(run(await confirm(), request)).resolves.toEqual({
      ok: false,
      code: "forbidden",
      stage: "creation",
      retry: false,
      text: "The cluster refused the creation of a DownloadRequest: the identity needs the verb create on downloadrequests of the namespace.",
    });
    state.phase = "New";
    const waited = randomUUID();

    await expect(run(await confirm(), waited)).resolves.toEqual({
      ok: false,
      code: "deadline",
      stage: "wait",
      retry: true,
      text: `Velero did not sign a URL in thirty seconds: its server may be stopped or busy, or it could not open the storage location. The DownloadRequest nightly-${waited} stays in velero until Velero removes it.`,
    });
    state.phase = "Processed";
    download.mockRejectedValueOnce(new DiagnosticError("artifact-missing"));
    const missing = randomUUID();

    await expect(run(await confirm(), missing)).resolves.toMatchObject({
      ok: false,
      code: "artifact-missing",
      stage: "download",
      text: expect.stringContaining(`The DownloadRequest nightly-${missing} stays in velero`),
    });
    // The plugin of the context that gave no credential is said as its own failure.
    adapter.read.mockRejectedValueOnce(new CredentialPluginError("/usr/local/bin/kubelogin", "failed"));
    await expect(run(await confirm())).resolves.toMatchObject({
      ok: false,
      code: "request-failed",
      stage: "target",
      retry: true,
      text: expect.stringContaining("The credential plugin kubelogin of the context did not give a credential"),
    });
    dispose();
  });

  it("is cancelled by the frame that asked it, while it waits for the URL, and leaves the request where it is", async () => {
    const { enable, confirm, run, call, adapter, state, route, dispose } = fixture();

    await enable();
    state.phase = "New";
    const request = randomUUID();
    const running = run(await confirm(), request);

    await vi.waitFor(() => expect(adapter.createDownload).toHaveBeenCalledTimes(1));
    await expect(call(CHANNELS.writeCancel, FRAME_A2, { cluster: "cluster-a", request })).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
    });
    await expect(call(CHANNELS.writeCancel, FRAME_A, { cluster: "cluster-a", request })).resolves.toEqual({
      ok: true,
      value: null,
    });
    await expect(running).resolves.toEqual({
      ok: false,
      code: "cancelled",
      stage: "wait",
      retry: true,
      text: `The download was cancelled. The DownloadRequest nightly-${request} stays in velero until Velero removes it.`,
    });
    expect(route).not.toHaveBeenCalled();
    // The way asked for its reads and its one creation, and nothing after the cancellation.
    expect(adapter.createDownload).toHaveBeenCalledTimes(1);
    const reads = adapter.read.mock.calls.length;

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(adapter.read.mock.calls.length).toBe(reads);
    dispose();
  });

  it("stops a download whose frame went, well before its wait would end, and holds no text for it", async () => {
    // A wait of thirty seconds, and writes turned on by a frame that stays: what ends the download is the
    // watch of its own frame, four times a second, and not the gate, which looks at the frame that turned
    // writes on.
    const { enable, call, adapter, state, holder, download, dispose } = fixture({ urlTimeoutMs: 30_000 });
    const frame = { senderFrame: { url: "https://cluster-a.renderer.freelens.app:1234/" }, processId: 1, frameId: 7 };

    await enable(FRAME_A);
    const confirmed = await call(CHANNELS.writeConfirm, frame, {
      cluster: "cluster-a",
      namespace: "velero",
      kind: "DownloadRequest",
      target: TARGET,
      artifact: "BackupLog",
    });
    const token = (confirmed.value as { token: string }).token;

    state.phase = "New";
    const running = call(CHANNELS.writeRun, frame, {
      cluster: "cluster-a",
      namespace: "velero",
      kind: "DownloadRequest",
      target: TARGET,
      artifact: "BackupLog",
      token,
      request: randomUUID(),
    });

    await vi.waitFor(() => expect(adapter.createDownload).toHaveBeenCalledTimes(1));
    // The frame is of another cluster now: the write is aborted on this side.
    const left = Date.now();

    frame.senderFrame = { url: "https://cluster-b.renderer.freelens.app:1234/" };
    await expect(running).resolves.toMatchObject({ ok: false, code: "forbidden", stage: "frame" });
    expect(Date.now() - left).toBeLessThan(2000);
    expect(download).not.toHaveBeenCalled();
    expect(holder.size).toBe(0);
    // The reads of the wait ended with it.
    const reads = adapter.read.mock.calls.length;

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(adapter.read.mock.calls.length).toBe(reads);
    dispose();
  });

  it("ends a download when writes are turned off, when the namespace changes and when the extension is released, and holds nothing of it", async () => {
    for (const end of ["off", "namespace", "released"] as const) {
      const { enable, confirm, run, call, adapter, state, holder, download, dispose } = fixture({
        urlTimeoutMs: 30_000,
      });

      await enable();
      state.phase = "New";
      const request = randomUUID();
      const running = run(await confirm(), request);

      await vi.waitFor(() => expect(adapter.createDownload).toHaveBeenCalledTimes(1));
      if (end === "off") await call(CHANNELS.gateDisable, FRAME_A, { cluster: "cluster-a" });
      else if (end === "namespace")
        await call(CHANNELS.gateEnable, FRAME_A, {
          cluster: "cluster-a",
          namespace: "other",
          confirmation: { context: "kind-a", namespace: "other" },
        });
      else dispose();
      // The request is in the cluster, and the words say that it stays.
      await expect(running).resolves.toEqual({
        ok: false,
        code: "cancelled",
        stage: "wait",
        retry: true,
        text: `The download was cancelled. The DownloadRequest nightly-${request} stays in velero until Velero removes it.`,
      });
      expect([end, download.mock.calls.length, holder.size]).toEqual([end, 0, 0]);
      dispose();
    }
  });

  it("holds nothing of a download that writes going off, or its cancellation, reached while what it opened was closed", async () => {
    for (const end of ["off", "cancelled"] as const) {
      const { enable, confirm, run, call, close, holder, dispose } = fixture();
      let closed: () => void = () => undefined;

      close.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            closed = resolve;
          }),
      );
      await enable();
      const request = randomUUID();
      const running = run(await confirm(), request);

      // The bytes arrived: only the route is still closing.
      await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
      if (end === "off") await call(CHANNELS.gateDisable, FRAME_A, { cluster: "cluster-a" });
      else await call(CHANNELS.writeCancel, FRAME_A, { cluster: "cluster-a", request });
      closed();
      await expect(running).resolves.toMatchObject({ ok: false, code: "cancelled", stage: "release", retry: true });
      expect([end, holder.size]).toEqual([end, 0]);
      dispose();
    }
  });

  it("cancels a download that waits its turn, before anything of it is asked of the cluster", async () => {
    const { enable, confirm, run, call, adapter, state, dispose } = fixture({ urlTimeoutMs: 30_000 });

    await enable();
    state.phase = "New";
    // Two downloads hold the two places of the process, and wait for their URL.
    const first = [run(await confirm()), run(await confirm())];

    await vi.waitFor(() => expect(adapter.createDownload).toHaveBeenCalledTimes(2));
    const reads = adapter.read.mock.calls.filter(([kind]) => kind === "Backup").length;
    const queued = randomUUID();
    const third = run(await confirm(), queued);

    await vi.waitFor(async () =>
      expect(await call(CHANNELS.writeStatus, FRAME_A, { cluster: "cluster-a", request: queued })).toEqual({
        ok: true,
        value: { step: "queue" },
      }),
    );
    await call(CHANNELS.writeCancel, FRAME_A, { cluster: "cluster-a", request: queued });
    await expect(third).resolves.toEqual({
      ok: false,
      code: "cancelled",
      stage: "queue",
      retry: true,
      text: "The request was cancelled before anything was created.",
    });
    // Its target was never read, and nothing was created for it.
    expect(adapter.read.mock.calls.filter(([kind]) => kind === "Backup")).toHaveLength(reads);
    expect(adapter.createDownload).toHaveBeenCalledTimes(2);
    state.phase = "Processed";
    await expect(Promise.all(first)).resolves.toMatchObject([{ ok: true }, { ok: true }]);
    dispose();
  });

  it("lets the texts of a cluster go when its entry changes after writes were turned off", async () => {
    const { enable, confirm, run, call, catalog, gate, holder, broadcasts, dispose } = fixture();

    await enable();
    await run(await confirm());
    // Writes turned off by the operator leave what was read where it is.
    await call(CHANNELS.gateDisable, FRAME_A, { cluster: "cluster-a" });
    expect(holder.size).toBe(1);
    // The entry points at another file: there is nothing to tell the frames, and the text goes.
    catalog[0] = { ...catalog[0], kubeConfigPath: "/synthetic/other" };
    gate.reconcile();
    expect(broadcasts).toEqual([]);
    expect(holder.size).toBe(0);
    dispose();
  });

  // A frame of the test that can go: the event the host gives is asked again for its frame.
  const leaving = () => ({
    senderFrame: { url: "https://cluster-a.renderer.freelens.app:1234/" },
    processId: 1,
    frameId: 4,
  });
  const GONE = { url: "https://cluster-b.renderer.freelens.app:1234/" };

  it("creates no request for a frame that went before the creation", async () => {
    const { enable, confirm, run, adapter, dispose } = fixture();
    const frame = leaving();

    await enable(frame);
    const token = await confirm("BackupLog", frame);

    // The frame goes while the certificate of the location is read, which is the last read before the creation.
    adapter.certificate.mockImplementationOnce(async () => {
      frame.senderFrame = GONE;
      return undefined;
    });
    await expect(run(token, randomUUID(), "BackupLog", frame)).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "frame",
    });
    expect(adapter.createDownload).not.toHaveBeenCalled();
    dispose();
  });

  it("holds no text for a frame that went while the bytes arrived, and answers it nothing of them", async () => {
    const { enable, confirm, run, download, holder, close, dispose } = fixture();
    const frame = leaving();

    await enable(frame);
    const token = await confirm("BackupLog", frame);

    download.mockImplementationOnce(async () => {
      frame.senderFrame = GONE;
      return Buffer.from(LOG);
    });
    await expect(run(token, randomUUID(), "BackupLog", frame)).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "frame",
    });
    expect(holder.size).toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("says of a route that is not a tunnel that it is direct, in the words of the contract", async () => {
    const { enable, confirm, run, route, dispose } = fixture();

    await enable();
    route.mockResolvedValueOnce({
      route: {
        origin: "https://storage.example.invalid",
        pathname: "/bucket/backups/nightly/nightly-logs.gz",
        address: "127.0.0.1",
        port: 1234,
        mode: "test" as never,
      },
      close: vi.fn(),
    });
    const answer = await run(await confirm());

    expect(answer).toMatchObject({ ok: true, value: { route: { mode: "direct" } } });
    expect(readAnswer(answer, readArtifactValue)).toEqual(answer);
    dispose();
  });

  it("ends every download for the gate: a cluster runs as many as it asks, one after the other", async () => {
    const { enable, confirm, run, dispose } = fixture();

    await enable();
    // More than the writes a cluster may have in flight at once.
    for (let count = 0; count < 20; count += 1) await expect(run(await confirm())).resolves.toMatchObject({ ok: true });
    dispose();
  });

  it("says nothing of what raised when a download ends in a way that is not named", () => {
    const context = { artifact: "BackupLog" as const, name: "nightly", namespace: "velero" };
    const said = downloadFailureOf(new Error(`connect ECONNREFUSED ${SIGNED}`), context);

    expect(said).toEqual({
      ok: false,
      code: "request-failed",
      stage: "handler",
      retry: false,
      text: "The request could not be made, for a reason the extension does not name.",
    });
    // The bound of the whole operation is said as such.
    const whole = new DiagnosticError("deadline", "creation", "whole");

    expect(downloadFailureOf(whole, { ...context, request: "nightly-request" }).text).toBe(
      "The operation did not end in two minutes, and was stopped while the request was created: the DownloadRequest nightly-request may be in velero.",
    );
    expect(downloadFailureOf(new DiagnosticError("deadline", "location"), context).text).toBe(
      "The cluster did not answer in time. No request was created.",
    );
    // What the request said of Velero is said as such, and a read that ended the same way is not.
    expect(downloadFailureOf(new DiagnosticError("request-failed", "wait", "failed"), context).text).toContain(
      "Velero could not process the request",
    );
    expect(downloadFailureOf(new DiagnosticError("request-failed", "wait"), context).text).not.toContain(
      "Velero could",
    );
  });
});
