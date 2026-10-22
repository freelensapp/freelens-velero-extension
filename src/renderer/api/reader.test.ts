import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forbiddenAccesses, hostCalls, hostViews } from "../../../test/freelens-extensions";
import { FAMILIES } from "../../common/discovery";
import { PATHS } from "../../common/paths";
import { clusterReader } from "./reader";

// What the client of the host was asked: for which cluster it was taken, and every call of it, with what each
// was given.
const taken: string[] = [];
const asked: { call: string; args: unknown[] }[] = [];
// What the next answers are, by path: a status and a text.
let answers: Record<string, { status: number; text: string }> = {};
// What was read of each answer.
const read: string[] = [];

// The answer of the client of the host, as its declaration has it (FetchResponse, structural, and not a
// `Response` of the DOM): every member a reader may read is there, and what is read is recorded.
function answerOf(status: number, text: string) {
  const answer = {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: () => null },
    body: null,
    text: async () => text,
    json: async () => JSON.parse(text),
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  };

  return new Proxy(answer, {
    get: (target, property, receiver) => {
      // What a promise looks for in what it resolves with is not a read of the answer.
      if (property === "then") return undefined;
      read.push(String(property));
      return Reflect.get(target, property, receiver);
    },
  });
}

// The client of the host for a cluster: whatever it is asked, it records, and only `getResponse` answers.
function fakeClient(cluster: string) {
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === "then") return undefined;
        return async (...args: unknown[]) => {
          asked.push({ call: String(property), args: [cluster, ...args] });
          if (property !== "getResponse") throw new Error(`not asked of a reader: ${String(property)}`);
          const answer = answers[args[0] as string] ?? { status: 404, text: "404 page not found\n" };

          return answerOf(answer.status, answer.text);
        };
      },
    },
  );
}

beforeEach(() => {
  hostCalls.length = 0;
  forbiddenAccesses.length = 0;
  taken.length = 0;
  asked.length = 0;
  read.length = 0;
  answers = {};
  hostViews.forCluster = (cluster) => {
    taken.push(cluster);
    return fakeClient(cluster);
  };
});

afterEach(() => {
  hostViews.forCluster = undefined;
});

describe("reader of the cluster of a frame", () => {
  it("asks the client of the host for its cluster, with GET and the path alone: no query, no header", async () => {
    const reader = clusterReader("cluster-a");
    const signal = new AbortController().signal;

    await reader(PATHS.discovery, signal);
    await reader(PATHS.locations);
    await reader(PATHS.family("backups", "velero-demo"), signal);
    expect(taken).toEqual(["cluster-a"]);
    expect(asked).toEqual([
      { call: "getResponse", args: ["cluster-a", "/apis/velero.io/v1", undefined, { method: "GET", signal }] },
      {
        call: "getResponse",
        args: [
          "cluster-a",
          "/apis/velero.io/v1/backupstoragelocations",
          undefined,
          { method: "GET", signal: undefined },
        ],
      },
      {
        call: "getResponse",
        args: ["cluster-a", "/apis/velero.io/v1/namespaces/velero-demo/backups", undefined, { method: "GET", signal }],
      },
    ]);
  });

  it("takes the client of the host at its first read, and asks nothing of the host before", async () => {
    const reader = clusterReader("cluster-a");

    expect(taken).toEqual([]);
    expect(forbiddenAccesses).toEqual([]);
    await reader(PATHS.discovery);
    await reader(PATHS.discovery);
    expect(taken).toEqual(["cluster-a"]);
  });

  it("gives the status and the body of the answer, and reads of it the status and the text alone", async () => {
    const list = { kind: "BackupList", items: [{ metadata: { name: "nightly", namespace: "velero-demo" } }] };
    const refused = { kind: "Status", apiVersion: "v1", status: "Failure", reason: "Forbidden", code: 403 };

    answers = {
      [PATHS.family("backups", "velero-demo")]: { status: 200, text: JSON.stringify(list) },
      [PATHS.family("restores", "velero-demo")]: { status: 403, text: JSON.stringify(refused) },
    };
    const reader = clusterReader("cluster-a");

    expect(await reader(PATHS.family("backups", "velero-demo"))).toEqual({ status: 200, body: list });
    expect(await reader(PATHS.family("restores", "velero-demo"))).toEqual({ status: 403, body: refused });
    expect([...new Set(read)].sort()).toEqual(["status", "text"]);
  });

  it("gives the status alone where the body is not one, and never a state from the text", async () => {
    answers = {
      [PATHS.discovery]: { status: 404, text: "404 page not found\n" },
      [PATHS.locations]: { status: 503, text: "forbidden: the words of a refusal are not a refusal" },
    };
    const reader = clusterReader("cluster-a");

    expect(await reader(PATHS.discovery)).toEqual({ status: 404 });
    expect(await reader(PATHS.locations)).toEqual({ status: 503 });
  });

  it("knows nothing of a read the client did not answer, and asks nothing of no cluster", async () => {
    hostViews.forCluster = () => ({
      getResponse: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await clusterReader("cluster-a")(PATHS.discovery)).toEqual({});
    hostViews.forCluster = () => ({
      getResponse: async () => ({ status: 200, text: async () => Promise.reject(new Error("aborted")) }),
    });
    expect(await clusterReader("cluster-a")(PATHS.discovery)).toEqual({});
    hostViews.forCluster = undefined;
    expect(await clusterReader("")(PATHS.discovery)).toEqual({});
    expect(forbiddenAccesses).toEqual([]);
  });

  it("creates no API of the host and registers nothing with it", async () => {
    const reader = clusterReader("cluster-a");

    for (const path of [PATHS.discovery, PATHS.locations, ...FAMILIES.map((family) => PATHS.family(family, "velero"))])
      await reader(path);
    expect(hostCalls).toEqual([]);
    expect(asked.every((call) => call.call === "getResponse")).toBe(true);
  });

  it("is given the paths of the kinds of Velero, and asks no other", async () => {
    // Every path the views have is under the group of Velero: none leads to a Secret.
    const paths = [PATHS.discovery, PATHS.locations, ...FAMILIES.map((family) => PATHS.family(family, "velero-demo"))];

    for (const path of paths) {
      expect(path.startsWith("/apis/velero.io/")).toBe(true);
      expect(path).not.toMatch(/secret/i);
    }
    const reader = clusterReader("cluster-a");

    // What is not one of them is not asked of the host, whoever gives it to the reader.
    for (const path of [
      "/api/v1/namespaces/velero-demo/secrets",
      "/api/v1/namespaces/velero-demo/secrets/cloud-credentials",
      "/api/v1/secrets",
      "/apis/velero.io/v1/../../../api/v1/secrets",
      // The same, written as an address writes what is not a letter.
      "/apis/velero.io/v1/%2e%2e/%2e%2e/%2e%2e/api/v1/secrets",
      "/apis/velero.io/v1/.%2e/secrets",
      "/apis/velero.io/v1/.\t./secrets",
      "/apis/velero.io/v1/backups?watch=true",
      "/apis/velero.io/v1/namespaces/velero-demo/backups/one/status",
      "/apis/velero.io/v1/namespaces/Velero/backups",
      "/apis/velero.io/v2/backups",
      "/apis/velero.io.example/v1/backups",
      "/apis/apps/v1/deployments",
      "apis/velero.io/v1/backups",
      " /apis/velero.io/v1/backups",
      "/apis/velero.io/v1/backups\n",
      "",
    ]) {
      expect(await reader(path)).toEqual({});
    }
    expect(taken).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("does not make a path of what is not the name of a namespace", () => {
    for (const name of ["", "Velero", "../velero", "velero/backups", "velero?watch=true"]) {
      expect(() => PATHS.family("backups", name)).toThrow("Not the name of a namespace");
    }
  });
});
