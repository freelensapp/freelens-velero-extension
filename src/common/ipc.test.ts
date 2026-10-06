import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_TARGETS,
  artifactKind,
  downloadRequestName,
  PAGE_BOUND,
  REQUEST_BOUND,
  readAllowanceRequest,
  readAnswer,
  readArtifactPage,
  readArtifactPageRequest,
  readArtifactReleaseRequest,
  readArtifactSaved,
  readArtifactValue,
  readGateDisableRequest,
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
  savedFileName,
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

  it("reads a confirmation of a write, of one artifact of one object for a DownloadRequest and of none for a ServerStatusRequest", () => {
    const download = { cluster, namespace: "velero", kind: "DownloadRequest", target, artifact: "BackupLog" };

    expect(readWriteConfirmRequest(download)).toEqual(download);
    // The artifact is a part of what is confirmed: a DownloadRequest without one is not a request.
    expect(readWriteConfirmRequest({ cluster, namespace: "velero", kind: "DownloadRequest", target })).toBeUndefined();
    expect(
      readWriteConfirmRequest({ cluster, namespace: "velero", kind: "ServerStatusRequest", artifact: "BackupLog" }),
    ).toBeUndefined();
    expect(readWriteConfirmRequest({ cluster, namespace: "velero", kind: "ServerStatusRequest" })).toEqual({
      cluster,
      namespace: "velero",
      kind: "ServerStatusRequest",
    });
    expect(readWriteConfirmRequest({ cluster, namespace: "velero", kind: "DownloadRequest" })).toBeUndefined();
    expect(
      readWriteConfirmRequest({ cluster, namespace: "velero", kind: "ServerStatusRequest", target }),
    ).toBeUndefined();
    expect(readWriteConfirmRequest({ ...download, kind: "Backup" })).toBeUndefined();
    expect(readWriteConfirmRequest({ ...download, target: { ...target, kind: "Pod" } })).toBeUndefined();
    expect(readWriteConfirmRequest({ ...download, target: { ...target, uid: "" } })).toBeUndefined();
    expect(readWriteConfirmRequest({ ...download, target: { ...target, name: "Not A Name" } })).toBeUndefined();
    expect(readWriteConfirmRequest({ ...download, target: { ...target, more: 1 } })).toBeUndefined();
  });

  it("takes the eight artifacts the extension shows, each of the kind of its target, and no other target of the API", () => {
    const of = (artifact: unknown, kind: string) => ({
      cluster,
      namespace: "velero",
      kind: "DownloadRequest",
      target: { ...target, kind },
      artifact,
    });

    expect(ARTIFACT_TARGETS).toHaveLength(8);
    for (const artifact of ARTIFACT_TARGETS) {
      const kind = artifactKind(artifact);
      const other = kind === "Backup" ? "Restore" : "Backup";

      expect([artifact, kind]).toEqual([artifact, artifact.startsWith("Backup") ? "Backup" : "Restore"]);
      expect(readWriteConfirmRequest(of(artifact, kind))).toMatchObject({ artifact, target: { kind } });
      // The log of a restore is not asked of a backup.
      expect([artifact, readWriteConfirmRequest(of(artifact, other))]).toEqual([artifact, undefined]);
    }
    // The six other targets of the API of the reviewed release, the contents of a backup first, and what
    // is not a target at all.
    for (const refused of [
      "BackupContents",
      "BackupVolumeSnapshots",
      "BackupItemOperations",
      "RestoreItemOperations",
      "CSIBackupVolumeSnapshots",
      "CSIBackupVolumeSnapshotContents",
      "backuplog",
      "BackupLog ",
      "",
      ["BackupLog"],
      { kind: "BackupLog" },
      1,
      null,
    ]) {
      expect([refused, readWriteConfirmRequest(of(refused, "Backup"))]).toEqual([refused, undefined]);
      expect([
        refused,
        readWriteRunRequest({ ...of(refused, "Backup"), token: randomUUID(), request: randomUUID() }),
      ]).toEqual([refused, undefined]);
    }
  });

  it("names a DownloadRequest after its target and the identifier of the request", () => {
    const request = randomUUID();

    expect(downloadRequestName("nightly", request)).toBe(`nightly-${request}`);
    expect(downloadRequestName("restore.of-monday", "0e7c")).toBe("restore.of-monday-0e7c");
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
      readWriteRunRequest({
        cluster,
        namespace: "velero",
        kind: "ServerStatusRequest",
        token,
        request,
        artifact: "BackupLog",
      }),
    ).toBeUndefined();
    // What is run is what was confirmed: an artifact that is not of the kind of its target is not read.
    expect(
      readWriteRunRequest({
        cluster,
        namespace: "velero",
        kind: "DownloadRequest",
        target,
        token,
        request,
        artifact: "RestoreLog",
      }),
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

  it("reads the request of a page of the text of an artifact, and the one that lets the text go", () => {
    const request = randomUUID();

    expect(readArtifactPageRequest({ cluster, request, page: 0 })).toEqual({ cluster, request, page: 0 });
    expect(readArtifactPageRequest({ cluster, request, page: 15 })).toEqual({ cluster, request, page: 15 });
    for (const page of [-1, 1.5, "0", Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, null, undefined]) {
      expect([page, readArtifactPageRequest({ cluster, request, page })]).toEqual([page, undefined]);
    }
    expect(readArtifactPageRequest({ cluster, request })).toBeUndefined();
    expect(readArtifactPageRequest({ cluster, request: "1", page: 0 })).toBeUndefined();
    expect(readArtifactPageRequest({ cluster, request, page: 0, url: "https://leak.invalid" })).toBeUndefined();
    expect(readArtifactReleaseRequest({ cluster, request })).toEqual({ cluster, request });
    expect(readArtifactReleaseRequest({ cluster, request, page: 0 })).toBeUndefined();
  });

  it("refuses a request beyond the bound, whatever its fields say", () => {
    // Every field is the one of a valid request: only what the request weighs between the processes is
    // beyond the bound, or cannot be weighed at all.
    const heavy = (fields: Record<string, unknown>, weight: number) =>
      Object.assign(Object.create({ toJSON: () => "x".repeat(weight) }), fields);
    const request = randomUUID();

    expect(readGateStateRequest(heavy({ cluster }, REQUEST_BOUND - 2))).toEqual({ cluster });
    expect(readGateStateRequest(heavy({ cluster }, REQUEST_BOUND + 1))).toBeUndefined();
    expect(readGateDisableRequest(heavy({ cluster }, REQUEST_BOUND + 1))).toBeUndefined();
    expect(readWriteStatusRequest(heavy({ cluster, request }, REQUEST_BOUND - 2))).toEqual({ cluster, request });
    expect(readWriteStatusRequest(heavy({ cluster, request }, REQUEST_BOUND + 1))).toBeUndefined();
    expect(
      readGateEnableRequest(
        heavy(
          { cluster, namespace: "velero", confirmation: { context: "kind-a", namespace: "velero" } },
          REQUEST_BOUND + 1,
        ),
      ),
    ).toBeUndefined();
    expect(
      readWriteConfirmRequest(heavy({ cluster, namespace: "velero", kind: "ServerStatusRequest" }, REQUEST_BOUND + 1)),
    ).toBeUndefined();
    const unreadable = Object.assign(
      Object.create({
        toJSON: () => {
          throw new Error("cannot be weighed");
        },
      }),
      { cluster },
    );

    expect(readGateStateRequest(unreadable)).toBeUndefined();
  });
});

describe("what the operator allows, between the processes", () => {
  const origin = "https://storage.example:9000";

  it("reads a request that allows or takes back: one cluster, one kind, one origin, and a location for an origin", () => {
    expect(readAllowanceRequest({ cluster, what: "origin", origin, location: "velero/default" })).toEqual({
      cluster,
      what: "origin",
      origin,
      location: "velero/default",
    });
    expect(readAllowanceRequest({ cluster, what: "private", origin })).toEqual({ cluster, what: "private", origin });
    expect(readAllowanceRequest({ cluster, what: "http", origin: "http://minio.storage:9000" })).toEqual({
      cluster,
      what: "http",
      origin: "http://minio.storage:9000",
    });
    for (const broken of [
      { what: "private", origin },
      { cluster, origin },
      { cluster, what: "private" },
      { cluster, what: "everything", origin },
      { cluster, what: "origin", origin },
      { cluster, what: "origin", origin, location: "Not A Name" },
      { cluster, what: "private", origin, location: "velero/default" },
      // What is allowed is an origin, and never a URL: nothing after the host and the port.
      { cluster, what: "private", origin: `${origin}/bucket/key` },
      { cluster, what: "private", origin: `${origin}?X-Amz-Signature=synthetic` },
      { cluster, what: "private", origin: "https://user:secret@storage.example" },
      { cluster, what: "private", origin: "HTTPS://Storage.example" },
      { cluster, what: "private", origin, since: 1 },
      { cluster: "../other", what: "private", origin },
      "allow everything",
      null,
    ])
      expect([broken, readAllowanceRequest(broken)]).toEqual([broken, undefined]);
  });

  it("reads in a failure what the operator may allow for the request to go on, and nothing else of that form", () => {
    const refused = { ok: false, code: "destination-denied", stage: "route", retry: false, text: "Not allowed yet." };
    const read = (needs: unknown) => readAnswer({ ...refused, needs }, readWriteConfirmAnswer);

    expect(read({ what: "origin", origin, location: "velero/default" })).toEqual({
      ...refused,
      needs: { what: "origin", origin, location: "velero/default" },
    });
    expect(read({ what: "private", origin })).toEqual({ ...refused, needs: { what: "private", origin } });
    // A failure that asks for nothing has no such field.
    expect(readAnswer(refused, readWriteConfirmAnswer)).toEqual(refused);
    for (const needs of [
      { what: "origin", origin },
      { what: "private", origin: `${origin}/bucket/key?X-Amz-Signature=synthetic` },
      { what: "private", origin, url: "https://leak.invalid" },
      { what: "everything", origin },
      "https://storage.example",
      null,
      [],
    ])
      expect([needs, read(needs)]).toEqual([needs, expect.objectContaining({ code: "validation", stage: "answer" })]);
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

  it("reads what the main process answers of an artifact: the request, the size, the pages and the route in words", () => {
    const value = {
      request: { name: "nightly-0e7c5b7a", uid: "uid" },
      size: 12,
      pages: 1,
      route: { mode: "tunnel", encrypted: false, origin: "http://storage.velero.svc:8333" },
    };

    expect(readArtifactValue(value)).toEqual(value);
    expect(readArtifactValue({ ...value, route: { ...value.route, mode: "direct", encrypted: true } })).toMatchObject({
      route: { mode: "direct", encrypted: true },
    });
    // A text of no byte is a text: it has no page.
    expect(readArtifactValue({ ...value, size: 0, pages: 0 })).toMatchObject({ size: 0, pages: 0 });
    expect(readArtifactValue({ ...value, route: { ...value.route, mode: "test" } })).toBeUndefined();
    expect(readArtifactValue({ ...value, route: { ...value.route, encrypted: "yes" } })).toBeUndefined();
    expect(readArtifactValue({ ...value, size: -1 })).toBeUndefined();
    expect(readArtifactValue({ ...value, pages: 1.5 })).toBeUndefined();
    expect(readArtifactValue({ ...value, request: { name: "nightly" } })).toBeUndefined();
    expect(readArtifactValue({ ...value, url: "https://leak.invalid/?X-Amz-Signature=1" })).toBeUndefined();
    // The origin of the store and nothing of a URL after it: no path, no query, no user.
    for (const origin of [
      "http://storage.velero.svc:8333/bucket/backups/nightly/nightly-logs.gz",
      "https://storage.example.invalid/?X-Amz-Signature=SENTINEL",
      "https://user:secret@storage.example.invalid",
      "https://storage.example.invalid#fragment",
      "ftp://storage.example.invalid",
      "storage.example.invalid",
      "",
      1,
    ]) {
      expect([origin, readArtifactValue({ ...value, route: { ...value.route, origin } })]).toEqual([origin, undefined]);
    }
  });

  it("reads a page of the text of an artifact, as large as a page is and no larger", () => {
    const page = { page: 0, pages: 2, text: 'time="2026-09-30T10:00:00Z" level=info msg="Backup completed"' };
    const full = { page: 1, pages: 2, text: "x".repeat(PAGE_BOUND) };

    expect(readArtifactPage(page)).toEqual(page);
    expect(readArtifactPage(full)).toEqual(full);
    expect(readArtifactPage({ ...full, text: `${full.text}x` })).toBeUndefined();
    expect(readArtifactPage({ ...page, page: 2 })).toBeUndefined();
    expect(readArtifactPage({ ...page, page: -1 })).toBeUndefined();
    expect(readArtifactPage({ ...page, text: ["x"] })).toBeUndefined();
    expect(readArtifactPage({ ...page, more: 1 })).toBeUndefined();
    // A page is beyond the bound of a request, and is read when its reader bounds it itself; every other
    // answer stays within the bound, and so does a failure, whoever reads it.
    expect(readAnswer({ ok: true, value: full }, readArtifactPage, true)).toEqual({ ok: true, value: full });
    expect(readAnswer({ ok: true, value: full }, readArtifactPage)).toMatchObject({ ok: false, stage: "answer" });
    expect(readAnswer({ ok: true, value: { ...full, text: `${full.text}x` } }, readArtifactPage, true)).toMatchObject({
      ok: false,
      stage: "answer",
    });
    expect(
      readAnswer(
        { ok: false, code: "forbidden", stage: "request", retry: false, text: "x".repeat(REQUEST_BOUND) },
        readArtifactPage,
        true,
      ),
    ).toMatchObject({ ok: false, code: "validation", stage: "answer" });
  });

  it("reads whether a text was saved, and nothing else of what the main process answers of a saving", () => {
    expect(readArtifactSaved({ saved: true })).toEqual({ saved: true });
    // The operator closed the dialog: nothing was written, and that is what the views read.
    expect(readArtifactSaved({ saved: false })).toEqual({ saved: false });
    for (const saved of ["true", 1, 0, null, undefined, {}]) {
      expect([saved, readArtifactSaved({ saved })]).toEqual([saved, undefined]);
    }
    expect(readArtifactSaved({})).toBeUndefined();
    expect(readArtifactSaved(null)).toBeUndefined();
    expect(readArtifactSaved(true)).toBeUndefined();
    // Nothing of a file crosses the contract: an answer that says where the text went is not one.
    expect(readArtifactSaved({ saved: true, path: "/home/operator/nightly-logs.txt" })).toBeUndefined();
    expect(readAnswer({ ok: true, value: { saved: false } }, readArtifactSaved)).toEqual({
      ok: true,
      value: { saved: false },
    });
  });

  it("suggests for the text of an artifact the name of its file in the store, as text, and nothing that is not of a name", () => {
    expect(ARTIFACT_TARGETS.map((artifact) => [artifact, savedFileName(artifact, "nightly")])).toEqual([
      ["BackupLog", "nightly-logs.txt"],
      ["RestoreLog", "restore-nightly-logs.txt"],
      ["BackupResults", "nightly-results.json"],
      ["RestoreResults", "restore-nightly-results.json"],
      ["BackupResourceList", "nightly-resource-list.json"],
      ["RestoreResourceList", "restore-nightly-resource-list.json"],
      ["BackupVolumeInfos", "nightly-volumeinfo.json"],
      ["RestoreVolumeInfo", "restore-nightly-volumeinfo.json"],
    ]);
    // The name of an object is of letters, digits, dots and dashes, and is written as it is.
    expect(savedFileName("BackupLog", "nightly.2026-09-30_a")).toBe("nightly.2026-09-30_a-logs.txt");
    // What is not a letter, a digit, a dot, a dash or an underscore is not written into the name of a
    // file: a name that is not the one of an object leads to no folder, and says nothing to a shell.
    expect(savedFileName("RestoreResults", "../of monday/night:è")).toBe("restore-.._of_monday_night__-results.json");
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
