// What the views show of a DownloadRequest before it is created is what the cluster is sent, and the text
// of its artifact comes back in pages: the whole way, from the client of the views through the IPC of the
// host, the gate and the adapter of the main process, to an API server of the test that keeps every
// request it receives. The store is not in this test: the route and the download are given by it.

import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:https";
import Module from "node:module";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type HostExtensionStub,
  hostCatalog,
  ipcBroadcasts,
  ipcFrame,
  ipcHandlers,
  resetIpc,
} from "../../test/freelens-extensions";
import { createTlsFixture } from "../../test/tls-fixture";
import { CHANNELS, DIAGNOSTIC_REQUEST_LABEL, PAGE_BOUND, REQUEST_LABELS } from "../common/ipc";
import { PreferencesStore } from "../common/preferences-store";
import { VeleroIpcRenderer } from "../renderer/api/ipc";
import { DiagnosticError } from "./diagnostic-transport";
import VeleroMain from "./index";
import { catalogEntries, VeleroIpc } from "./ipc";

import type { SaveDialog } from "./artifact-save";
import type { ArtifactRoute } from "./diagnostic-transport";

const CLUSTER = "synthetic-cluster";
const CONTEXT = "kind-synthetic";
const NAMESPACE = "velero";
const API = `/apis/velero.io/v1/namespaces/${NAMESPACE}`;
const BACKUP = { kind: "Backup" as const, name: "nightly", uid: "backup-uid" };
const RESTORE = { kind: "Restore" as const, name: "nightly-back", uid: "restore-uid" };
const ORIGIN = "https://storage.synthetic.invalid";
const SENTINEL = "PRIVATE-SENTINEL-OF-THE-SIGNATURE";
const LOG = 'time="2026-09-30T10:00:00Z" level=info msg="Backup completed"\n';

let certificates: Awaited<ReturnType<typeof createTlsFixture>>;
let server: Server;
let kubeconfig: string;
let main: VeleroIpc;
let renderer: VeleroIpcRenderer;
// What the API server of the test was sent, what it keeps of the requests it was sent, and what it does
// with a creation.
const received: { method?: string; path?: string; body?: unknown }[] = [];
const requests = new Map<string, { object: Record<string, unknown>; reads: number }>();
let refuseCreation = false;
// Whether the controller of the test signs a URL for the requests it is sent.
let signs = true;
// What the download of the test ends with, when it is not the text of the store.
let storeFails: DiagnosticError | undefined;
// What the route and the download of the test were asked, and what the store of the test holds.
const routed: { url: string; target: string; location: string }[] = [];
const downloaded: { url: string; route: ArtifactRoute }[] = [];
let closed = 0;
let stored = Buffer.from(LOG);

function objectOf(kind: string, name: string, uid: string, spec: Record<string, unknown>) {
  return { apiVersion: "velero.io/v1", kind, metadata: { name, namespace: NAMESPACE, uid }, spec };
}

beforeAll(async () => {
  certificates = await createTlsFixture();
  server = createServer(certificates, async (request, response) => {
    const chunks: Buffer[] = [];

    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;

    received.push({ method: request.method, path: request.url, ...(body === undefined ? {} : { body }) });
    if (request.headers.authorization !== "Bearer synthetic-token") {
      response.writeHead(401).end();
      return;
    }
    const path = request.url ?? "";

    if (request.method === "POST" && path === `${API}/downloadrequests`) {
      if (refuseCreation) {
        response.writeHead(403).end();
        return;
      }
      const object = { ...body, metadata: { ...body.metadata, uid: `uid-of-${body.metadata.name}` } };

      requests.set(body.metadata.name, { object, reads: 0 });
      response.writeHead(201).end(JSON.stringify(object));
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405).end();
      return;
    }
    if (path === `${API}/backups/${BACKUP.name}`)
      response.end(JSON.stringify(objectOf("Backup", BACKUP.name, BACKUP.uid, { storageLocation: "default" })));
    else if (path === `${API}/restores/${RESTORE.name}`)
      response.end(JSON.stringify(objectOf("Restore", RESTORE.name, RESTORE.uid, { backupName: BACKUP.name })));
    else if (path === `${API}/backupstoragelocations/default`)
      response.end(
        JSON.stringify(
          objectOf("BackupStorageLocation", "default", "location-uid", {
            provider: "aws",
            objectStorage: { bucket: "synthetic" },
          }),
        ),
      );
    else if (path.startsWith(`${API}/downloadrequests/`)) {
      const kept = requests.get(path.slice(`${API}/downloadrequests/`.length));

      if (!kept) {
        response.writeHead(404).end();
        return;
      }
      kept.reads += 1;
      // The server has not looked at the request the first time it is read: it signs at the second.
      response.end(
        JSON.stringify(
          signs && kept.reads > 1
            ? {
                ...kept.object,
                status: {
                  phase: "Processed",
                  downloadURL: `${ORIGIN}/synthetic/backups/${BACKUP.name}/file.gz?X-Amz-Signature=${SENTINEL}`,
                  expiration: new Date(Date.now() + 600_000).toISOString(),
                },
              }
            : kept.object,
        ),
      );
    } else response.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  if (!address || typeof address === "string") throw new Error("Missing API fixture listener");
  kubeconfig = join(certificates.directory, "kubeconfig.json");
  await writeFile(
    kubeconfig,
    JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      contexts: [{ name: CONTEXT, context: { cluster: "synthetic", user: "synthetic" } }],
      clusters: [
        {
          name: "synthetic",
          cluster: {
            server: `https://127.0.0.1:${address.port}`,
            "certificate-authority-data": Buffer.from(certificates.ca).toString("base64"),
          },
        },
      ],
      users: [{ name: "synthetic", user: { token: "synthetic-token" } }],
    }),
    { mode: 0o600 },
  );
});

// The route and the download of the test, which stand in the place of the store.
const STORE: NonNullable<Parameters<VeleroIpc["register"]>[1]> = {
  route: async (url, input, storage) => {
    routed.push({ url, target: input.target, location: storage.metadata.name });
    return {
      route: { origin: ORIGIN, pathname: new URL(url).pathname, address: "192.0.2.1", port: 443, mode: "tunnel" },
      close: () => {
        closed += 1;
      },
    };
  },
  download: {
    pollMs: 5,
    download: async (url, route) => {
      downloaded.push({ url, route });
      if (storeFails) throw storeFails;
      return stored;
    },
  },
};

// The procedures as the extension registers them, with the route and the download of the test in place
// of the store.
function register(): void {
  main = VeleroIpc.createInstance({} as never);
  main.register(catalogEntries, STORE);
}

// The module of Electron is not there where the tests run. What the main process requires of it at a
// save is what a test puts in its place, as a suite does in the application: until what is returned is
// called, the dialog of the host is the one the test answers.
function withDialog(dialog: SaveDialog): () => void {
  const loader = Module as unknown as { _load(request: string, ...more: unknown[]): unknown };
  const load = loader._load;

  loader._load = (request, ...more) => (request === "electron" ? { dialog } : load.call(loader, request, ...more));
  return () => {
    loader._load = load;
  };
}

beforeEach(() => {
  received.length = 0;
  requests.clear();
  routed.length = 0;
  downloaded.length = 0;
  closed = 0;
  stored = Buffer.from(LOG);
  refuseCreation = false;
  signs = true;
  storeFails = undefined;
  resetIpc();
  hostCatalog.clusters = [{ id: CLUSTER, name: "synthetic", kubeConfigPath: kubeconfig, contextName: CONTEXT }];
  register();
  renderer = VeleroIpcRenderer.createInstance({} as never);
});

afterEach(() => {
  main.release();
  hostCatalog.clusters = undefined;
  resetIpc();
});

afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await certificates?.dispose();
});

// Turns writes on and confirms one artifact of one target, as a tab does with its two gestures.
async function confirmed(target: typeof BACKUP | typeof RESTORE, artifact: Parameters<typeof renderer.confirm>[4]) {
  const enabled = await renderer.enable(CLUSTER, NAMESPACE, { context: CONTEXT, namespace: NAMESPACE });
  const confirmation = await renderer.confirm(CLUSTER, NAMESPACE, "DownloadRequest", target, artifact);

  if (!enabled.ok || !confirmation.ok) throw new Error("The gate of the test did not open");
  return confirmation.value.token;
}

const sent = () => received.map((request) => `${request.method} ${request.path}`);

describe("the object of a DownloadRequest, as the cluster is sent it", () => {
  it("names the label of the identifier of a request, beside the one of the extension", () => {
    expect(DIAGNOSTIC_REQUEST_LABEL).toBe("freelensapp.io/diagnostic-request");
  });

  it("is the one of the target that was confirmed, named by the target and the identifier, and nothing is sent before the run", async () => {
    const token = await confirmed(BACKUP, "BackupLog");
    const request = randomUUID();

    // Turning writes on and confirming a write ask the cluster nothing.
    expect(received).toEqual([]);
    const answer = await renderer.runDownload(CLUSTER, NAMESPACE, BACKUP, "BackupLog", token, request);
    const name = `${BACKUP.name}-${request}`;

    expect(received.find((entry) => entry.method === "POST")).toEqual({
      method: "POST",
      path: `${API}/downloadrequests`,
      body: {
        apiVersion: "velero.io/v1",
        kind: "DownloadRequest",
        metadata: { namespace: NAMESPACE, name, labels: { ...REQUEST_LABELS, [DIAGNOSTIC_REQUEST_LABEL]: request } },
        spec: { target: { kind: "BackupLog", name: BACKUP.name } },
      },
    });
    expect(answer).toEqual({
      ok: true,
      value: {
        request: { name, uid: `uid-of-${name}` },
        size: Buffer.byteLength(LOG),
        pages: 1,
        route: { mode: "tunnel", encrypted: true, origin: ORIGIN },
      },
    });
    // The way, in its order: the target, the location of its backup, the target again, the creation, the
    // request until it carries a URL, and the target once more before the text is delivered. One creation,
    // and nothing deleted or changed.
    expect(sent()).toEqual([
      `GET ${API}/backups/${BACKUP.name}`,
      `GET ${API}/backupstoragelocations/default`,
      `GET ${API}/backups/${BACKUP.name}`,
      `POST ${API}/downloadrequests`,
      `GET ${API}/downloadrequests/${name}`,
      `GET ${API}/downloadrequests/${name}`,
      `GET ${API}/backups/${BACKUP.name}`,
    ]);
    // The route is asked for the URL the request carries, with the location of the backup, and closed.
    expect(routed).toEqual([{ url: expect.stringContaining(SENTINEL), target: "BackupLog", location: "default" }]);
    expect(downloaded).toHaveLength(1);
    expect(closed).toBe(1);
  });

  it("reads the backup of a restore before its location, and names the restore in the request", async () => {
    const token = await confirmed(RESTORE, "RestoreResults");
    const request = randomUUID();
    const answer = await renderer.runDownload(CLUSTER, NAMESPACE, RESTORE, "RestoreResults", token, request);

    expect(answer).toMatchObject({ ok: true, value: { request: { name: `${RESTORE.name}-${request}` } } });
    expect(sent().slice(0, 5)).toEqual([
      `GET ${API}/restores/${RESTORE.name}`,
      `GET ${API}/backups/${BACKUP.name}`,
      `GET ${API}/backupstoragelocations/default`,
      `GET ${API}/restores/${RESTORE.name}`,
      `POST ${API}/downloadrequests`,
    ]);
    expect(received.find((entry) => entry.method === "POST")?.body).toMatchObject({
      spec: { target: { kind: "RestoreResults", name: RESTORE.name } },
    });
  });

  it("gives the text in pages to the frame that asked for it, and no more once it is let go", async () => {
    // A text of three pages, of characters of more than one byte: no page ends inside a character.
    const line = "è il registro di una prova, riga per riga, con lettere accentate: àèìòù\n";
    const text = line.repeat(Math.ceil((2 * PAGE_BOUND + 1024) / Buffer.byteLength(line)));

    stored = Buffer.from(text);
    const token = await confirmed(BACKUP, "BackupLog");
    const request = randomUUID();
    const answer = await renderer.runDownload(CLUSTER, NAMESPACE, BACKUP, "BackupLog", token, request);

    expect(answer).toMatchObject({ ok: true, value: { size: stored.length, pages: 3 } });
    let read = "";

    for (let page = 0; page < 3; page += 1) {
      const given = await renderer.page(CLUSTER, request, page);

      if (!given.ok) throw new Error(`The page ${page} was not given`);
      expect(Buffer.byteLength(given.value.text)).toBeLessThanOrEqual(PAGE_BOUND);
      read += given.value.text;
    }
    expect(read).toBe(text);
    expect(await renderer.page(CLUSTER, request, 3)).toMatchObject({ ok: false, code: "not-found", stage: "delivery" });
    // Another frame of the same cluster is given nothing of it.
    const asking = ipcFrame.current;

    ipcFrame.current = { ...asking, frameId: asking.frameId + 1 };
    expect(await renderer.page(CLUSTER, request, 0)).toMatchObject({ ok: false, code: "not-found" });
    ipcFrame.current = asking;
    expect(await renderer.release(CLUSTER, request)).toEqual({ ok: true, value: null });
    expect(await renderer.page(CLUSTER, request, 0)).toMatchObject({ ok: false, code: "not-found", stage: "delivery" });
    // Nothing of this asked the cluster again.
    expect(received.filter((entry) => entry.method === "POST")).toHaveLength(1);
  });

  it("carries the signed URL in no answer, no status and no broadcast", async () => {
    const token = await confirmed(BACKUP, "BackupLog");
    const request = randomUUID();
    const answer = await renderer.runDownload(CLUSTER, NAMESPACE, BACKUP, "BackupLog", token, request);
    const page = await renderer.page(CLUSTER, request, 0);
    const status = await renderer.status(CLUSTER, request);
    const said = JSON.stringify([answer, page, status, ipcBroadcasts]);

    expect(downloaded[0]?.url).toContain(SENTINEL);
    expect(said).not.toContain(SENTINEL);
    expect(said).not.toMatch(/X-Amz|downloadURL|file\.gz/);
  });

  it("runs once for a confirmation: the token of a download that ran creates nothing more", async () => {
    const token = await confirmed(BACKUP, "BackupLog");

    await renderer.runDownload(CLUSTER, NAMESPACE, BACKUP, "BackupLog", token, randomUUID());
    const again = await renderer.runDownload(CLUSTER, NAMESPACE, BACKUP, "BackupLog", token, randomUUID());

    expect(again).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    expect(received.filter((entry) => entry.method === "POST")).toHaveLength(1);
  });

  it("creates one request for a run that is sent again while it runs", async () => {
    const token = await confirmed(BACKUP, "BackupLog");
    const request = randomUUID();
    const [first, second] = await Promise.all([
      renderer.runDownload(CLUSTER, NAMESPACE, BACKUP, "BackupLog", token, request),
      renderer.runDownload(CLUSTER, NAMESPACE, BACKUP, "BackupLog", token, request),
    ]);

    expect(first).toMatchObject({ ok: true });
    expect(second).toEqual(first);
    expect(received.filter((entry) => entry.method === "POST")).toHaveLength(1);
  });

  it("does not run for another artifact than the one that was confirmed", async () => {
    const token = await confirmed(BACKUP, "BackupLog");
    const answer = await renderer.runDownload(CLUSTER, NAMESPACE, BACKUP, "BackupResults", token, randomUUID());

    expect(answer).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    expect(received).toEqual([]);
  });

  it("says that the cluster refused the creation, with the kind and the verb it needs, and leaves writes on", async () => {
    const token = await confirmed(BACKUP, "BackupLog");

    refuseCreation = true;
    const answer = await renderer.runDownload(CLUSTER, NAMESPACE, BACKUP, "BackupLog", token, randomUUID());

    expect(answer).toEqual({
      ok: false,
      code: "forbidden",
      stage: "creation",
      retry: false,
      text: "The cluster refused the creation of a DownloadRequest: the identity needs the verb create on downloadrequests of the namespace.",
    });
    expect(received.filter((entry) => entry.method === "POST")).toHaveLength(1);
    expect(routed).toEqual([]);
    expect(await renderer.state(CLUSTER)).toMatchObject({
      ok: true,
      value: { writes: { on: true, namespace: NAMESPACE } },
    });
  });

  it("takes of a download only what the contract names: an answer that carries more is a failure of the way", async () => {
    const answered = {
      request: { name: "nightly-request", uid: "request-uid" },
      size: 1,
      pages: 1,
      route: { mode: "tunnel", encrypted: true, origin: ORIGIN },
    };
    const answers = [
      { ...answered, route: { ...answered.route, origin: `${ORIGIN}/synthetic/file.gz?X-Amz-Signature=${SENTINEL}` } },
      { ...answered, url: `${ORIGIN}/synthetic/file.gz?X-Amz-Signature=${SENTINEL}` },
      { ...answered, route: { ...answered.route, mode: "test" } },
    ];

    for (const value of answers) {
      // A main process that answers what the contract does not give.
      ipcHandlers.set(CHANNELS.writeRun, async () => ({ ok: true, value }));
      const answer = await renderer.runDownload(CLUSTER, NAMESPACE, BACKUP, "BackupLog", randomUUID(), randomUUID());

      expect(answer).toMatchObject({ ok: false, code: "validation", stage: "answer" });
      expect(JSON.stringify(answer)).not.toContain(SENTINEL);
    }
    ipcHandlers.set(CHANNELS.writeRun, async () => ({ ok: true, value: answered }));
    expect(await renderer.runDownload(CLUSTER, NAMESPACE, BACKUP, "BackupLog", randomUUID(), randomUUID())).toEqual({
      ok: true,
      value: answered,
    });
  });

  it("takes of a saving only whether a file was written: an answer that says more, or something else, is a failure of the way", async () => {
    const answers = [
      { saved: true, path: `/home/operator/${SENTINEL}.txt` },
      { saved: "yes" },
      { written: true },
      null,
    ];

    for (const value of answers) {
      // A main process that answers what the contract does not give.
      ipcHandlers.set(CHANNELS.artifactSave, async () => ({ ok: true, value }));
      const answer = await renderer.save(CLUSTER, randomUUID());

      expect(answer).toMatchObject({ ok: false, code: "validation", stage: "answer" });
      expect(JSON.stringify(answer)).not.toContain(SENTINEL);
    }
    for (const saved of [true, false]) {
      ipcHandlers.set(CHANNELS.artifactSave, async () => ({ ok: true, value: { saved } }));
      expect(await renderer.save(CLUSTER, randomUUID())).toEqual({ ok: true, value: { saved } });
    }
  });

  it("saves a text into the file the operator chooses in the dialog of the host, as the extension is activated, and writes no other", async () => {
    main.release();
    resetIpc();
    const folder = await mkdtemp(join(certificates.directory, "saved-"));
    // The dialogs the host was asked for, with what each was told, which the test answers as the operator.
    const dialogs: { told: unknown; answer: (chosen: { canceled: boolean; filePath?: string }) => void }[] = [];
    const restoreDialog = withDialog({
      showSaveDialog: (told) => new Promise((answer) => dialogs.push({ told, answer })),
    });
    const opened = (count: number) => vi.waitFor(() => expect(dialogs).toHaveLength(count));
    // The extension as the host activates it, with the store of the test beside what it registers.
    const registered = VeleroIpc.prototype.register;
    const registering = vi.spyOn(VeleroIpc.prototype, "register").mockImplementation(function (
      this: VeleroIpc,
      catalog,
      more,
    ) {
      registered.call(this, catalog, { ...more, ...STORE });
    });
    const extension = Reflect.construct(VeleroMain, []) as HostExtensionStub;

    extension.activate();
    try {
      const token = await confirmed(BACKUP, "BackupLog");
      const request = randomUUID();

      expect(await renderer.runDownload(CLUSTER, NAMESPACE, BACKUP, "BackupLog", token, request)).toMatchObject({
        ok: true,
      });
      // The command that saves names the text by its cluster and its request: the main process opens the
      // dialog of the host, which is suggested a name and told what is saved.
      const saving = renderer.save(CLUSTER, request);
      const title = "Save the log of the backup nightly, of velero in the cluster synthetic";

      await opened(1);
      expect(dialogs[0].told).toEqual({ title, message: title, defaultPath: "nightly-logs.txt" });
      expect(await readdir(folder)).toEqual([]);
      // The operator chooses a file, under another name than the one that was suggested: the text is
      // written there, whole, and nowhere else.
      dialogs[0].answer({ canceled: false, filePath: join(folder, "chosen by the operator.log") });
      expect(await saving).toEqual({ ok: true, value: { saved: true } });
      expect(await readdir(folder)).toEqual(["chosen by the operator.log"]);
      expect(await readFile(join(folder, "chosen by the operator.log"), "utf8")).toBe(LOG);
      // Saving lets nothing go: the text is still held, and is saved again. A dialog the operator closes
      // writes nothing, and that is what is answered.
      expect(await renderer.page(CLUSTER, request, 0)).toMatchObject({ ok: true, value: { text: LOG } });
      const left = renderer.save(CLUSTER, request);

      await opened(2);
      dialogs[1].answer({ canceled: true, filePath: join(folder, "not chosen.log") });
      expect(await left).toEqual({ ok: true, value: { saved: false } });
      // The view lets the text go while a dialog is open, and a file is chosen after: nothing is written.
      const late = renderer.save(CLUSTER, request);

      await opened(3);
      expect(await renderer.release(CLUSTER, request)).toEqual({ ok: true, value: null });
      dialogs[2].answer({ canceled: false, filePath: join(folder, "chosen too late.log") });
      expect(await late).toMatchObject({ ok: false, code: "not-found", stage: "delivery" });
      expect(await readdir(folder)).toEqual(["chosen by the operator.log"]);
      // None of it asked the cluster for anything more than the download did.
      expect(received.filter((entry) => entry.method === "POST")).toHaveLength(1);
      expect([...new Set(received.map((entry) => entry.method))].sort()).toEqual(["GET", "POST"]);
    } finally {
      extension.disable();
      registering.mockRestore();
      restoreDialog();
    }
  });

  it("asks the cluster for reads and one creation in every way a download ends, and never for a change or a removal", async () => {
    // The store has no such file; then the request is cancelled while Velero is waited for.
    storeFails = new DiagnosticError("artifact-missing");
    const missing = randomUUID();

    expect(
      await renderer.runDownload(
        CLUSTER,
        NAMESPACE,
        BACKUP,
        "BackupLog",
        await confirmed(BACKUP, "BackupLog"),
        missing,
      ),
    ).toMatchObject({
      ok: false,
      code: "artifact-missing",
      stage: "download",
      text: expect.stringContaining(`The DownloadRequest ${BACKUP.name}-${missing} stays in ${NAMESPACE}`),
    });
    expect(closed).toBe(1);
    signs = false;
    const waited = randomUUID();
    const running = renderer.runDownload(
      CLUSTER,
      NAMESPACE,
      BACKUP,
      "BackupLog",
      await confirmed(BACKUP, "BackupLog"),
      waited,
    );

    // The request is in the cluster and was read once: the way waits for its URL.
    for (let tries = 0; !requests.get(`${BACKUP.name}-${waited}`)?.reads && tries < 400; tries += 1)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await renderer.cancel(CLUSTER, waited)).toEqual({ ok: true, value: null });
    expect(await running).toMatchObject({ ok: false, code: "cancelled", stage: "wait" });
    // Both requests are in the cluster of the test, as they were created: nothing removed or changed them.
    expect([...requests.keys()].sort()).toEqual([`${BACKUP.name}-${missing}`, `${BACKUP.name}-${waited}`].sort());
    expect(received.filter((entry) => entry.method === "POST")).toHaveLength(2);
    expect([...new Set(received.map((entry) => entry.method))].sort()).toEqual(["GET", "POST"]);
  });

  it("finds the route by itself as the extension is activated, and asks the operator for an origin the location does not give", async () => {
    main.release();
    resetIpc();
    // The extension as the host activates it, and not the procedures as this test registers them.
    const extension = Reflect.construct(VeleroMain, []) as HostExtensionStub;

    extension.activate();
    try {
      const token = await confirmed(BACKUP, "BackupLog");
      const request = randomUUID();
      const answer = await renderer.runDownload(CLUSTER, NAMESPACE, BACKUP, "BackupLog", token, request);

      // The location of the test is of AWS without a URL of its own, and the URL is not of AWS: the
      // operator is asked, with the origin and nothing after it, and what is asked crosses the contract.
      expect(answer).toMatchObject({
        ok: false,
        code: "destination-denied",
        stage: "route",
        retry: false,
        needs: { what: "origin", origin: ORIGIN, location: "velero/default" },
      });
      expect(JSON.stringify(answer)).not.toContain(SENTINEL);
      // The request was created, and nothing was connected to.
      expect(received.filter((entry) => entry.method === "POST")).toHaveLength(1);
      expect(requests.has(`${BACKUP.name}-${request}`)).toBe(true);
      expect(downloaded).toEqual([]);
      // Allowed through the procedure of the extension, for the cluster of the frame, it is kept by the
      // store of the preferences the main process opened.
      expect(await renderer.allow(CLUSTER, { what: "origin", origin: ORIGIN, location: "velero/default" })).toEqual({
        ok: true,
        value: null,
      });
      const store = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
      const kept = {
        [CLUSTER]: [{ what: "origin", origin: ORIGIN, location: "velero/default", since: expect.any(Number) }],
      };

      expect(store.read().allowances).toEqual(kept);
      // The process the extension is activated in is the one that keeps the allowances: once the host
      // loaded the store, what a window sends of them, for this cluster or for another, changes nothing.
      store.fromStore(store.toJSON());
      store.fromStore({
        ...store.toJSON(),
        allowances: { [CLUSTER]: [], "another-cluster": [{ what: "private", origin: ORIGIN, since: 1 }] },
      });
      expect(store.read().allowances).toEqual(kept);
      expect(await renderer.takeBack(CLUSTER, { what: "origin", origin: ORIGIN, location: "velero/default" })).toEqual({
        ok: true,
        value: null,
      });
      expect("allowances" in PreferencesStore.getInstanceOrCreate<PreferencesStore>().read()).toBe(false);
    } finally {
      extension.disable();
    }
  });
});
