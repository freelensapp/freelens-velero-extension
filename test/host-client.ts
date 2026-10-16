// A stand-in of the client of the host for the API server of a cluster, `Main.K8sApi.KubeJsonApi.forCluster`,
// written from the source of the host at the validation target,
// packages/utility-features/json-api/src/json-api.ts at 5e1870e97467edab81b856a4983483d0729db896:
// - `getResponse` (lines 139-157) gives the answer whatever its status: a structural answer with its status
//   and its body, which arrives as a stream and stops when the signal of the request is aborted;
// - `get` and `post` (lines 159-173, 199-254) read the body whole and reject when the status is not 2xx: a
//   GET answered 403 with the body itself, the `Status` object or its text when it is not JSON, and every
//   other failure with a `JsonApiErrorParsed`, which is not an `Error` and carries the body it parsed as
//   `error`; a request that gets no answer rejects with the error of the fetch.
// Every request is recorded: the cluster it was made for, the call, the method, the path, the query, the
// headers and the body, as the client was given them.

export interface HostRequest {
  cluster: string;
  call: "getResponse" | "get" | "post";
  method: string;
  path: string;
  query?: Record<string, unknown>;
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal | null;
}

// What the API server of a test answers a request with: an answer with a status and a body, given whole or
// in chunks, perhaps without end, or a body that stops arriving after its chunks; a rejection of the
// client, as it is; or nothing until the request is stopped.
export type HostReply =
  | { status: number; body?: unknown; chunks?: Iterable<Uint8Array>; stall?: boolean }
  | { reject: unknown }
  | { hang: true };

type Init = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal | null;
};

// The error the client of the host parses from an answer that is not 2xx, by the shape of its class: it is
// not exported by the host, and it is not an `Error`.
export class JsonApiErrorParsedDouble {
  isUsedForNotification = false;

  constructor(
    readonly error: unknown,
    private readonly messages: string[],
  ) {}

  get isAborted(): boolean {
    return (this.error as { code?: unknown } | undefined)?.code === 20;
  }

  toString(): string {
    return this.messages.join("\n");
  }
}

// What the fetch of the host rejects with when the signal of a request is aborted.
function abortedBy(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("This operation was aborted", "AbortError");
}

// The body of an answer as a stream, pulled one chunk at a time, which errors when the request is stopped.
// A body that stalls gives nothing more after its chunks, and does not end.
function streamOf(
  chunks: Iterable<Uint8Array>,
  signal: AbortSignal | null | undefined,
  record: { pulled: number; cancelled: boolean; aborted: boolean },
  stall = false,
): ReadableStream<Uint8Array> {
  const iterator = chunks[Symbol.iterator]();
  let errored = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener(
        "abort",
        () => {
          if (errored) return;
          errored = true;
          record.aborted = true;
          controller.error(abortedBy(signal));
        },
        { once: true },
      );
    },
    pull(controller): Promise<void> | undefined {
      if (errored) return undefined;
      const next = iterator.next();

      if (!next.done) {
        record.pulled += 1;
        controller.enqueue(next.value);
        return undefined;
      }
      // A body that stalls is pulled again only when what it waits for comes, which is never.
      if (stall) return new Promise<void>(() => undefined);
      controller.close();
      return undefined;
    },
    cancel() {
      record.cancelled = true;
    },
  });
}

export function fakeHostClient(reply: (request: HostRequest) => HostReply | Promise<HostReply>) {
  const requests: HostRequest[] = [];
  // What was read of the body of each answer that was given, and whether what was left of it was let go, or
  // stopped with its request.
  const bodies: { path: string; pulled: number; cancelled: boolean; aborted: boolean }[] = [];

  const answer = async (
    request: HostRequest,
  ): Promise<{
    status: number;
    body: ReadableStream<Uint8Array> | null;
    ok: boolean;
    statusText: string;
    headers: { get(name: string): string | null };
    text(): Promise<string>;
    json(): Promise<unknown>;
    arrayBuffer(): Promise<ArrayBuffer>;
  }> => {
    const { signal } = request;

    if (signal?.aborted) throw abortedBy(signal);
    const replied = await reply(request);

    if ("reject" in replied) throw replied.reject;
    if ("hang" in replied)
      return new Promise((_resolve, reject) => {
        if (!signal) return;
        signal.addEventListener("abort", () => reject(abortedBy(signal)), { once: true });
      });
    const record = { path: request.path, pulled: 0, cancelled: false, aborted: false };
    const chunks =
      replied.chunks ??
      (replied.body === undefined
        ? []
        : [new TextEncoder().encode(typeof replied.body === "string" ? replied.body : JSON.stringify(replied.body))]);
    const body = streamOf(chunks, signal, record, replied.stall);

    bodies.push(record);
    const text = async () => {
      const reader = body.getReader();
      const parts: Uint8Array[] = [];

      for (;;) {
        const { done, value } = await reader.read();

        if (done) break;
        parts.push(value);
      }
      return Buffer.concat(parts).toString("utf8");
    };

    return {
      ok: replied.status >= 200 && replied.status < 300,
      status: replied.status,
      statusText: "",
      headers: { get: () => null },
      body,
      text,
      json: async () => JSON.parse(await text()),
      arrayBuffer: async () => new TextEncoder().encode(await text()).buffer as ArrayBuffer,
    };
  };
  const recorded = (
    cluster: string,
    call: HostRequest["call"],
    path: string,
    params: { query?: Record<string, unknown>; data?: unknown } | undefined,
    init: Init | undefined,
    method: string,
  ): HostRequest => {
    const request: HostRequest = {
      cluster,
      call,
      method,
      path,
      ...(params?.query ? { query: { ...params.query } } : {}),
      headers: { ...init?.headers },
      ...(init?.body !== undefined
        ? { body: JSON.parse(init.body) }
        : params?.data !== undefined
          ? { body: params.data }
          : {}),
      signal: init?.signal,
    };

    requests.push(request);
    return request;
  };
  // What `get` and `post` do with an answer: read it whole, and reject by its status.
  const parsed = async (response: Awaited<ReturnType<typeof answer>>, method: string): Promise<unknown> => {
    const text = await response.text();
    let data: unknown = text;

    try {
      data = JSON.parse(text || "{}");
    } catch {
      data = text;
    }
    if (response.status >= 200 && response.status < 300) return data;
    if (method === "GET" && response.status === 403) throw data;
    const message =
      typeof data === "string"
        ? data
        : typeof (data as { message?: unknown })?.message === "string"
          ? (data as { message: string }).message
          : response.statusText || "Error!";

    throw new JsonApiErrorParsedDouble(data, [message]);
  };

  const forCluster = (cluster: string) => ({
    getResponse: (path: string, params?: { query?: Record<string, unknown> }, init?: Init) =>
      answer(recorded(cluster, "getResponse", path, params, init, (init?.method ?? "GET").toUpperCase())),
    get: async (path: string, params?: { query?: Record<string, unknown> }, init?: Init) =>
      parsed(await answer(recorded(cluster, "get", path, params, init, "GET")), "GET"),
    post: async (path: string, params?: { query?: Record<string, unknown>; data?: unknown }, init?: Init) =>
      parsed(await answer(recorded(cluster, "post", path, params, init, "POST")), "POST"),
  });

  return { forCluster, requests, bodies };
}

// A JSON answer of the API server.
export function answered(status: number, body?: unknown): HostReply {
  return { status, ...(body === undefined ? {} : { body }) };
}

// The `Status` the API server answers a refusal with.
export function statusOf(code: number, reason: string, message = `synthetic ${reason}`): Record<string, unknown> {
  return { kind: "Status", apiVersion: "v1", metadata: {}, status: "Failure", message, reason, code };
}
