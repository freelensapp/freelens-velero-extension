import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forbiddenAccesses, hostCalls, hostViews } from "../../../test/freelens-extensions";
import { FAMILIES } from "../../common/discovery";
import { PATHS } from "../../common/paths";
import { clusterReader } from "./reader";

// What the client of the host was asked: for which cluster it was taken, and every call of it, with what each
// was given.
const taken: string[] = [];
const asked: { call: string; args: unknown[] }[] = [];
// What the next answers are, by path: a status, a text, the headers of the answer, and the time the request
// takes, by which the clock of the test moves before it answers.
interface Given {
  status: number;
  text: string;
  headers?: Record<string, string>;
  // Headers that throw when one is asked.
  broken?: boolean;
  took?: number;
}
let answers: Record<string, Given> = {};
// What was read of each answer, and the names of the headers asked of it.
const read: string[] = [];
const headersAsked: string[] = [];

// The answer of the client of the host, as its declaration has it (FetchResponse, structural, and not a
// `Response` of the DOM): every member a reader may read is there, and what is read is recorded.
function answerOf({ status, text, headers = {}, broken = false }: Given) {
  // The headers of an answer are found by their name, whatever its case, as the ones of a fetch are.
  const byName = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  const answer = {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: {
      get: (name: string) => {
        headersAsked.push(name);
        if (broken) throw new Error("The headers of this answer cannot be read");
        return byName.get(name.toLowerCase()) ?? null;
      },
    },
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

          if (answer.took !== undefined) vi.setSystemTime(Date.now() + answer.took);
          return answerOf(answer);
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
  headersAsked.length = 0;
  answers = {};
  hostViews.forCluster = (cluster) => {
    taken.push(cluster);
    return fakeClient(cluster);
  };
});

afterEach(() => {
  hostViews.forCluster = undefined;
  vi.useRealTimers();
});

const ASKED = Date.parse("2026-10-15T12:00:00.000Z");

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

  it("gives the status and the body of the answer, and reads of it the status, the text and the header Date alone", async () => {
    const list = { kind: "BackupList", items: [{ metadata: { name: "nightly", namespace: "velero-demo" } }] };
    const refused = { kind: "Status", apiVersion: "v1", status: "Failure", reason: "Forbidden", code: 403 };

    answers = {
      [PATHS.family("backups", "velero-demo")]: { status: 200, text: JSON.stringify(list) },
      [PATHS.family("restores", "velero-demo")]: { status: 403, text: JSON.stringify(refused) },
    };
    const reader = clusterReader("cluster-a");

    expect(await reader(PATHS.family("backups", "velero-demo"))).toEqual({ status: 200, body: list });
    expect(await reader(PATHS.family("restores", "velero-demo"))).toEqual({ status: 403, body: refused });
    expect([...new Set(read)].sort()).toEqual(["headers", "status", "text"]);
    expect(headersAsked).toEqual(["date", "date"]);
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
      // The Deployment of the server, where a time zone could be set: the zone is derived, never read there.
      "/apis/apps/v1/namespaces/velero-demo/deployments",
      "/apis/apps/v1/namespaces/velero-demo/deployments/velero",
      "/apis/velero.io/v1/../../apps/v1/namespaces/velero-demo/deployments/velero",
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

describe("the time of the API server, in the header Date of an answer", () => {
  it("is the second it names and half a second, beside the clock of this machine in the middle of the request", async () => {
    vi.setSystemTime(ASKED);
    // The request took 400 ms; the header names the second three seconds after it was asked.
    answers = {
      [PATHS.family("schedules", "velero-demo")]: {
        status: 200,
        text: '{"items":[]}',
        headers: { Date: "Thu, 15 Oct 2026 12:00:03 GMT" },
        took: 400,
      },
    };
    expect(await clusterReader("cluster-a")(PATHS.family("schedules", "velero-demo"))).toEqual({
      status: 200,
      body: { items: [] },
      date: Date.parse("2026-10-15T12:00:03.500Z"),
      at: Date.parse("2026-10-15T12:00:00.200Z"),
    });
  });

  it("is nothing when the answer carries no header Date", async () => {
    vi.setSystemTime(ASKED);
    answers = { [PATHS.family("schedules", "velero-demo")]: { status: 200, text: '{"items":[]}', took: 50 } };
    expect(await clusterReader("cluster-a")(PATHS.family("schedules", "velero-demo"))).toEqual({
      status: 200,
      body: { items: [] },
    });
  });

  it.each([
    ["a text", "yesterday"],
    ["an instant of another form", "2026-10-15T12:00:03Z"],
    ["a date in another zone", "Thu, 15 Oct 2026 12:00:03 CEST"],
    ["a day of the week that is not the one of the date", "Fri, 15 Oct 2026 12:00:03 GMT"],
    ["a day that is not in the month", "Thu, 31 Sep 2026 12:00:03 GMT"],
    ["an hour that is not in the day", "Thu, 15 Oct 2026 25:00:03 GMT"],
    ["nothing", ""],
  ])("is nothing when the header Date is %s", async (_case, header) => {
    vi.setSystemTime(ASKED);
    answers = {
      [PATHS.family("schedules", "velero-demo")]: {
        status: 200,
        text: '{"items":[]}',
        headers: { Date: header },
        took: 50,
      },
    };
    expect(await clusterReader("cluster-a")(PATHS.family("schedules", "velero-demo"))).toEqual({
      status: 200,
      body: { items: [] },
    });
  });

  it("is given with an answer that refused the read as well: the reader says what the answer carried", async () => {
    vi.setSystemTime(ASKED);
    answers = {
      [PATHS.family("backups", "velero-demo")]: {
        status: 403,
        text: '{"kind":"Status"}',
        headers: { date: "Thu, 15 Oct 2026 11:59:58 GMT" },
        took: 20,
      },
    };
    expect(await clusterReader("cluster-a")(PATHS.family("backups", "velero-demo"))).toEqual({
      status: 403,
      body: { kind: "Status" },
      date: Date.parse("2026-10-15T11:59:58.500Z"),
      at: Date.parse("2026-10-15T12:00:00.010Z"),
    });
  });

  it("is nothing when the headers of the answer cannot be read, which takes nothing of its status and its body", async () => {
    answers = {
      [PATHS.family("schedules", "velero-demo")]: { status: 200, text: '{"items":[]}', broken: true, took: 50 },
    };
    expect(await clusterReader("cluster-a")(PATHS.family("schedules", "velero-demo"))).toEqual({
      status: 200,
      body: { items: [] },
    });
  });

  it("is given with an answer whose body is not an object", async () => {
    vi.setSystemTime(ASKED);
    answers = {
      [PATHS.discovery]: {
        status: 503,
        text: "the cluster is not reachable",
        headers: { Date: "Thu, 15 Oct 2026 12:00:00 GMT" },
        took: 0,
      },
    };
    expect(await clusterReader("cluster-a")(PATHS.discovery)).toEqual({
      status: 503,
      date: Date.parse("2026-10-15T12:00:00.500Z"),
      at: ASKED,
    });
  });
});
