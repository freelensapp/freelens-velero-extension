// What the views show of a request before it is created is what the main process creates: the prefix of
// its generated name and its labels, as the adapter is given them.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CHANNELS, REQUEST_LABELS, REQUEST_PREFIX } from "../common/ipc";
import { registerHandlers } from "./ipc";
import { SERVER_STATUS_PREFIX } from "./server-status";

import type { IpcEvent } from "./ipc";

const given = vi.hoisted(() => ({ labels: [] as unknown[] }));

vi.mock("./diagnostic-kubernetes", () => ({
  DiagnosticKubernetes: class {
    constructor(_binding: unknown, _isCurrent: unknown, labels: unknown) {
      given.labels.push(labels);
    }
  },
}));

let directory: string;
let file: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "velero-request-object-"));
  file = join(directory, "kubeconfig");
  await writeFile(
    file,
    JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      contexts: [{ name: "kind-a", context: { cluster: "a", user: "a" } }],
      clusters: [{ name: "a", cluster: { server: "https://127.0.0.1:6443", "certificate-authority-data": "Q0E=" } }],
      users: [{ name: "a", user: { token: "synthetic-token" } }],
    }),
    { mode: 0o600 },
  );
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("the object of a request, as the views show it", () => {
  it("has the prefix of the generated name the main process creates with", () => {
    expect(REQUEST_PREFIX).toBe(SERVER_STATUS_PREFIX);
  });

  it("has the labels the main process gives the adapter it creates with", async () => {
    const handlers = new Map<string, (event: IpcEvent, payload: unknown) => Promise<unknown>>();
    const dispose = registerHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler), broadcast: () => undefined },
      { catalog: () => [{ id: "cluster-a", name: "demo", kubeConfigPath: file, contextName: "kind-a" }] },
    );

    try {
      const answer = await handlers.get(CHANNELS.gateEnable)?.(
        { senderFrame: { url: "https://cluster-a.renderer.freelens.app:1234/" }, processId: 1, frameId: 4 },
        { cluster: "cluster-a", namespace: "velero", confirmation: { context: "kind-a", namespace: "velero" } },
      );

      expect(answer).toMatchObject({ ok: true });
      expect(given.labels).toEqual([REQUEST_LABELS]);
    } finally {
      dispose();
    }
  });
});
