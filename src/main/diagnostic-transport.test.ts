import { createHmac } from "node:crypto";
import { once } from "node:events";
import http, { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import https, { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { type AddressInfo, createServer as createListener, type Server as Listener, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import tls, { type TLSSocket } from "node:tls";
import { inspect } from "node:util";
import zlib, { gzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTlsFixture } from "../../test/tls-fixture";
import { ARTIFACT_TEXT_BOUND } from "../common/ipc";
import {
  type ArtifactRoute,
  type DiagnosticCode,
  type DiagnosticError,
  DOWNLOAD_LIMITS,
  type DownloadLimits,
  downloadArtifact,
  validateArtifactRoute,
} from "./diagnostic-transport";

// What a store checks of a signed URL, as the signer of the reviewed plugin makes one: the signature is
// over the path, the query and the host, and the host is the one the endpoint was written with, capitals
// included, without its port when the port is the one of the scheme.
const signature = (host: string, target: string) =>
  createHmac("sha256", "synthetic-key-of-the-store").update(`GET\n${target}\nhost:${host}`).digest("hex");
const presigned = (endpoint: string, path: string) => {
  const host = endpoint.replace(/^https?:\/\//, "").replace(endpoint.startsWith("https:") ? /:443$/ : /:80$/, "");
  const target = `${path}?X-Amz-SignedHeaders=host`;

  return `${endpoint}${target}&X-Amz-Signature=${signature(host, target)}`;
};
// The answer of the store to a signed URL: the file when the signature is the one of the host it was
// sent, and a refusal when it is not.
const signed = (request: IncomingMessage, response: ServerResponse) => {
  if (!request.url?.startsWith("/signed")) return false;
  const [target, given] = request.url.split("&X-Amz-Signature=");

  if (given !== signature(request.headers.host ?? "", target)) response.writeHead(403).end();
  else response.end(gzipSync(JSON.stringify({ host: request.headers.host, path: request.url })));
  return true;
};
// What the decoder of the runtime gives at once, at most: a text longer than it arrives in parts.
const DECODED_AT_ONCE = zlib.constants.Z_DEFAULT_CHUNK;
const server = createServer((request, response) => {
  if (signed(request, response)) return;
  if (request.url?.startsWith("/missing")) {
    response.writeHead(404).end();
    return;
  }
  if (request.url?.startsWith("/redirect")) {
    response.writeHead(302, { Location: "http://169.254.169.254/" }).end();
    return;
  }
  if (request.url?.startsWith("/denied")) {
    response.writeHead(403).end();
    return;
  }
  if (request.url?.startsWith("/waiting")) return;
  if (request.url?.startsWith("/invalid-gzip")) {
    response.end("not-gzip");
    return;
  }
  // What is not gzip, and has not ended when it is found not to be.
  if (request.url?.startsWith("/invalid-parts")) {
    response.write(Buffer.alloc(64 * 1024, "n"));
    return;
  }
  // A text the decoder gives in more than one part: four times what it gives at once.
  if (request.url?.startsWith("/long")) {
    response.end(gzipSync("x".repeat(4 * DECODED_AT_ONCE)));
    return;
  }
  // A text of as many bytes as its path says, of the bound of a text or beyond it.
  if (request.url?.startsWith("/sized-")) {
    response.end(gzipSync(Buffer.alloc(Number(request.url.slice("/sized-".length)), "x")));
    return;
  }
  // A file whose length is not declared, sent in parts.
  if (request.url?.startsWith("/parts")) {
    const parts = gzipSync("x".repeat(4096));

    response.write(parts.subarray(0, 8));
    response.end(parts.subarray(8));
    return;
  }
  // The beginning of a file, then the connection closed under it.
  if (request.url?.startsWith("/broken")) {
    response.writeHead(200, { "Content-Length": 4096 });
    response.write(gzipSync("x".repeat(4096)).subarray(0, 8), () => request.socket.destroy());
    return;
  }
  const content = request.url?.startsWith("/large")
    ? "x".repeat(4096)
    : JSON.stringify({
        host: request.headers.host,
        path: request.url,
        authorization: request.headers.authorization ?? null,
      });

  response.end(gzipSync(content));
});
let port = 0;
let tlsPort = 0;
let certificates: Awaited<ReturnType<typeof createTlsFixture>>;
let tlsServer: HttpsServer;
const route = (pathname = "/artifact%2Fkey") =>
  ({
    origin: "http://storage.example.invalid:8333",
    pathname,
    address: "127.0.0.1",
    port,
    mode: "test",
    allowHttp: true,
  }) satisfies ArtifactRoute;
// The listeners a test opens for itself on the loopback, and the connections they took: all are closed
// when the test ends.
const opened: Listener[] = [];
const taken = new Set<Socket>();
const watch = (listener: Listener) =>
  listener.on("connection", (socket) => {
    taken.add(socket);
    // The other side may end a connection with a reset, which is an error of this one.
    socket.on("error", () => undefined);
    socket.once("close", () => taken.delete(socket));
  });
const listening = async (listener: Listener, address = "127.0.0.1") => {
  opened.push(watch(listener));
  listener.listen(0, address);
  await once(listener, "listening");
  return (listener.address() as AddressInfo).port;
};
// A port of the loopback nothing listens on: the one a listener was just given, once that listener is
// closed. Nothing holds it afterwards, and a test in which something else took it in between fails with
// the code that other thing gives.
const unused = async () => {
  const listener = createListener();
  const free = await listening(listener);

  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return free;
};

beforeAll(async () => {
  watch(server).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  if (!address || typeof address === "string") throw new Error("Missing test listener");
  port = address.port;
  certificates = await createTlsFixture();
  tlsServer = createHttpsServer(certificates, (request, response) => {
    if (signed(request, response)) return;
    response.end(
      gzipSync(
        JSON.stringify({
          host: request.headers.host,
          sni: (request.socket as TLSSocket).servername,
          path: request.url,
        }),
      ),
    );
  });
  watch(tlsServer).listen(0, "127.0.0.1");
  await once(tlsServer, "listening");
  const tlsAddress = tlsServer.address();

  if (!tlsAddress || typeof tlsAddress === "string") throw new Error("Missing TLS test listener");
  tlsPort = tlsAddress.port;
});
afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const socket of taken) socket.destroy();
  await Promise.all(
    opened.splice(0).map((listener) => new Promise<void>((resolve) => listener.close(() => resolve()))),
  );
});
afterAll(async () => {
  server.closeAllConnections();
  tlsServer?.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (tlsServer) await new Promise<void>((resolve) => tlsServer.close(() => resolve()));
  await certificates?.dispose();
});

describe("bounded main artifact transport", () => {
  it("preserves signed Host, encoded path and exact query while changing only the socket destination", async () => {
    const path = "/artifact%2Fkey?X-Amz-Signature=synthetic%2Bsignature&x=2&x=1";
    const content = await downloadArtifact(`${route().origin}${path}`, route(), new AbortController().signal);

    expect(JSON.parse(content.toString())).toEqual({ host: "storage.example.invalid:8333", path, authorization: null });
  });

  it.each([
    "http://elsewhere.invalid/artifact%2Fkey",
    "http://user:secret@storage.example.invalid:8333/artifact%2Fkey",
    "http://storage.example.invalid:8333/artifact%2Fkey#fragment",
    "http://storage.example.invalid:8333/other",
    "http://storage.example.invalid:8333/./artifact%2Fkey",
  ])("denies an unauthorized or rewritten URL", (url) => {
    expect(() => validateArtifactRoute(url, route())).toThrow("destination-denied");
  });

  it.each(["169.254.169.254", "0.0.0.0", "224.0.0.1", "::ffff:169.254.169.254", "fe80::1"])(
    "denies metadata and invalid destinations: %s",
    (address) => {
      expect(() =>
        validateArtifactRoute(`${route().origin}${route().pathname}`, { ...route(), address, allowPrivate: true }),
      ).toThrow("destination-denied");
    },
  );

  it("takes a route that is direct, through a tunnel or to a server of a test, and no other word for it", () => {
    const url = `${route().origin}${route().pathname}`;

    // A tunnel, and a server of a test, are on the loopback of this machine, and nowhere else.
    for (const mode of ["tunnel", "test"] as const) {
      expect(validateArtifactRoute(url, { ...route(), mode })).toMatchObject({ address: "127.0.0.1" });
      expect(() => validateArtifactRoute(url, { ...route(), mode, address: "8.8.8.8" })).toThrow("destination-denied");
    }
    expect(validateArtifactRoute(url, { ...route(), mode: "direct", address: "8.8.8.8" })).toMatchObject({
      address: "8.8.8.8",
    });
    // A word that is none of the three says nothing of how the address is reached: it is refused.
    for (const mode of [undefined, "", "Tunnel", "TEST", "any"])
      for (const address of ["127.0.0.1", "8.8.8.8"])
        expect(() => validateArtifactRoute(url, { ...route(), mode: mode as never, address })).toThrow(
          "destination-denied",
        );
  });

  it("rejects silent HTTP/private/loopback fallback", () => {
    const url = `${route().origin}${route().pathname}`;

    expect(() => validateArtifactRoute(url, { ...route(), allowHttp: false })).toThrow();
    expect(() => validateArtifactRoute(url, { ...route(), mode: "direct" })).toThrow();
    expect(() => validateArtifactRoute(url, { ...route(), mode: "direct", address: "10.0.0.1" })).toThrow();
  });

  it.each([
    ["/missing", "artifact-missing"],
    ["/redirect", "destination-denied"],
  ])("classifies %s without following a redirect", async (path, code) => {
    await expect(
      downloadArtifact(`${route().origin}${path}`, route(path), new AbortController().signal),
    ).rejects.toMatchObject({ code });
  });

  it("limits compressed and decompressed bytes independently", async () => {
    const url = `${route().origin}/large`;

    await expect(
      downloadArtifact(url, route("/large"), new AbortController().signal, { ...DOWNLOAD_LIMITS, compressed: 4 }),
    ).rejects.toMatchObject({ code: "payload-too-large" });
    await expect(
      downloadArtifact(url, route("/large"), new AbortController().signal, { ...DOWNLOAD_LIMITS, decoded: 128 }),
    ).rejects.toMatchObject({ code: "payload-too-large" });
  });

  it("takes a text as large as the views take one, and not a byte more", async () => {
    // How a download of so many bytes of text ends: with its size, or with the code of its failure. The
    // text itself is not what is looked at.
    const sized = (bytes: number) =>
      downloadArtifact(`${route().origin}/sized-${bytes}`, route(`/sized-${bytes}`), new AbortController().signal).then(
        (content) => content.length,
        (error: DiagnosticError) => error.code,
      );

    // The bound of a download that is given none is the one of the text of an artifact, 64 MiB: what the
    // main process decodes is what the views hold, and no file is decoded for nothing.
    expect(ARTIFACT_TEXT_BOUND).toBe(64 * 1024 ** 2);
    expect(await sized(ARTIFACT_TEXT_BOUND)).toBe(ARTIFACT_TEXT_BOUND);
    expect(await sized(ARTIFACT_TEXT_BOUND + 1)).toBe("payload-too-large");
    // Two texts of that size are compressed and read here: the time of a machine that is busy is given.
  }, 60_000);

  it("rejects malformed gzip instead of returning partial content", async () => {
    await expect(
      downloadArtifact(`${route().origin}/invalid-gzip`, route("/invalid-gzip"), new AbortController().signal),
    ).rejects.toMatchObject({ code: "artifact-invalid" });
  });

  it("cancels socket I/O and does not include a signed URL in the error", async () => {
    const controller = new AbortController();
    const arrived = once(server, "request");
    const pending = downloadArtifact(
      `${route().origin}/waiting?secret=synthetic`,
      route("/waiting"),
      controller.signal,
    );
    const rejected = expect(pending).rejects.toMatchObject({
      code: "cancelled",
      message: "Diagnostic operation failed: cancelled",
    });
    const [request] = await arrived;
    const closed = once(request.socket, "close");

    controller.abort();
    await rejected;
    await closed;
  });

  it("terminates a stalled response at a bounded deadline", async () => {
    await expect(
      downloadArtifact(`${route().origin}/waiting`, route("/waiting"), new AbortController().signal, {
        ...DOWNLOAD_LIMITS,
        totalMs: 40,
        idleMs: 20,
      }),
    ).rejects.toMatchObject({ code: "deadline" });
  });

  it("preserves TLS SNI and signed authority with an explicitly trusted local CA", async () => {
    const policy: ArtifactRoute = {
      ...route(),
      origin: "https://storage.example.invalid:8333",
      port: tlsPort,
      ca: certificates.ca,
    };
    const path = "/artifact%2Fkey?signature=synthetic%2Bvalue";
    const content = await downloadArtifact(`${policy.origin}${path}`, policy, new AbortController().signal);

    expect(JSON.parse(content.toString())).toEqual({
      host: "storage.example.invalid:8333",
      sni: "storage.example.invalid",
      path,
    });
  });

  it("rejects unknown CAs and incorrect certificate hostnames without insecure fallback", async () => {
    const policy: ArtifactRoute = { ...route(), origin: "https://storage.example.invalid:8333", port: tlsPort };

    await expect(
      downloadArtifact(`${policy.origin}${policy.pathname}`, policy, new AbortController().signal),
    ).rejects.toMatchObject({ code: "tls-invalid" });
    const wrongName = { ...policy, origin: "https://wrong.example.invalid:8333", ca: certificates.ca };

    await expect(
      downloadArtifact(`${wrongName.origin}${wrongName.pathname}`, wrongName, new AbortController().signal),
    ).rejects.toMatchObject({ code: "tls-invalid" });
  });
});

describe("the rules on the address of a route, whatever the form it is written in", () => {
  const url = () => `${route().origin}${route().pathname}`;

  it.each([
    // The loopback of IPv6 written in full, outside a tunnel.
    ["0:0:0:0:0:0:0:1", "direct"],
    ["::0001", "direct"],
    ["0000:0000:0000:0000:0000:0000:0000:0001", "direct"],
    // The metadata addresses, with the allowance of the private ones: the one of IPv6 is inside fc00::/7.
    ["fd00:ec2::254", "direct"],
    ["FD00:EC2:0:0:0:0:0:254", "direct"],
    ["168.63.129.16", "direct"],
    // 169.254.169.254 as a translator of IPv6 to IPv4 would be given it.
    ["64:ff9b::a9fe:a9fe", "direct"],
    ["64:FF9B:0:0:0:0:169.254.169.254", "direct"],
    ["64:ff9b::a9fe:a9fe", "test"],
    // An IPv4 address on a socket of IPv6, whatever the address is: the route gives the IPv4 address itself.
    ["::ffff:8.8.8.8", "direct"],
    ["::ffff:10.0.0.1", "direct"],
    ["::FFFF:7F00:1", "tunnel"],
    ["0:0:0:0:0:ffff:127.0.0.1", "test"],
    // What is not an address as one is written: a zone, a prefix length, a leading zero.
    ["fe80::1%lo0", "test"],
    ["::1%lo0", "test"],
    ["127.0.0.1/8", "test"],
    ["0127.0.0.1", "test"],
  ] as const)("denies %s as the address of a %s route", (address, mode) => {
    expect(() => validateArtifactRoute(url(), { ...route(), mode, address, allowPrivate: true })).toThrow(
      "destination-denied",
    );
  });

  it.each(["0:0:0:0:0:0:0:1", "::0001", "::1"])("takes %s for the loopback a tunnel listens on", (address) => {
    expect(validateArtifactRoute(url(), { ...route(), mode: "tunnel", address })).toMatchObject({ address: "::1" });
  });

  it("asks the allowance of a private address in every form of it, and of an IPv4 one inside a translated one", () => {
    for (const address of ["FD12:3456:789A:0:0:0:0:1", "fd12:3456:789a::1", "64:ff9b::10.0.0.1"]) {
      const direct = { ...route(), mode: "direct" as const, address };

      expect(() => validateArtifactRoute(url(), direct)).toThrow("destination-denied");
      expect(validateArtifactRoute(url(), { ...direct, allowPrivate: true })).toMatchObject({
        hostname: "storage.example.invalid",
      });
    }
    // A public address a translator of IPv6 to IPv4 gives needs none.
    expect(validateArtifactRoute(url(), { ...route(), mode: "direct", address: "64:FF9B::808:808" })).toMatchObject({
      address: "64:ff9b::8.8.8.8",
    });
  });

  it.each([
    "http://[64:ff9b::a9fe:a9fe]:8333",
    "http://[::ffff:a9fe:a9fe]:8333",
    "http://[fd00:ec2::254]:8333",
    "http://[FD00:EC2::254]:8333",
    "http://168.63.129.16:8333",
    "http://metadata.google.internal:8333",
    "http://metadata.google.internal.:8333",
    "http://Metadata.Google.Internal:8333",
  ])("denies a URL whose host is %s, whatever the route", (written) => {
    const origin = new URL(written).origin;

    expect(() => validateArtifactRoute(`${written}${route().pathname}`, { ...route(), origin })).toThrow(
      "destination-denied",
    );
  });

  it("connects to the address in its canonical form", async () => {
    const answering = createServer((_request, response) => response.end(gzipSync("from the loopback of IPv6")));
    const policy = {
      ...route(),
      mode: "tunnel" as const,
      address: "0:0:0:0:0:0:0:1",
      port: await listening(answering, "::1"),
    };
    const requested = vi.spyOn(http, "request");

    syncBuiltinESMExports();
    const content = await downloadArtifact(url(), policy, new AbortController().signal);

    expect(content.toString()).toBe("from the loopback of IPv6");
    // The socket is given the form the rules were checked on, and not the one the route was written in.
    expect(requested.mock.calls).toMatchObject([[{ hostname: "::1" }]]);
  });
});

describe("the written form of the URL", () => {
  it.each([
    // The port of the scheme, written, and capitals in the host: the same origin.
    [
      "https://Host.example:443",
      "https://host.example",
      { hostname: "host.example", host: "Host.example", secure: true },
    ],
    ["https://host.example:443", "https://host.example", { hostname: "host.example", host: "host.example" }],
    [
      "http://HOST.EXAMPLE:80",
      "http://host.example",
      { hostname: "host.example", host: "HOST.EXAMPLE", secure: false },
    ],
    // Another port is part of the host a store is sent.
    ["http://Host.example:8333", "http://host.example:8333", { hostname: "host.example", host: "Host.example:8333" }],
    ["https://Host.example:80", "https://host.example:80", { hostname: "host.example", host: "Host.example:80" }],
    ["http://[FD12::1]:80", "http://[fd12::1]", { hostname: "fd12::1", host: "[FD12::1]" }],
  ])("takes %s for the origin %s, and keeps the host as it is written", (written, origin, expected) => {
    const target = "/key%2Fof?X-Amz-Signature=Synthetic%2BSignature";

    expect(
      validateArtifactRoute(`${written}${target}`, { ...route("/key%2Fof"), origin, allowPrivate: true }),
    ).toMatchObject({ ...expected, target });
  });

  it.each([
    // A port that is not written as a number is.
    "https://host.example:/key",
    "https://host.example:0443/key",
    "https://host.example:443:443/key",
    // Another port, another name, another scheme.
    "https://host.example:444/key",
    "https://host.example.:443/key",
    "http://host.example:443/key",
    // What a parser reads as the same host and a store does not.
    "https://ho%73t.example/key",
    "https://host.example%2e/key",
    "https://user@Host.example:443/key",
    "https://Host.example:443\\@elsewhere.invalid/key",
    "HTTPS://host.example/key",
    "https:/host.example/key",
  ])("still denies %s", (url) => {
    expect(() => validateArtifactRoute(url, { ...route("/key"), origin: "https://host.example" })).toThrow(
      "destination-denied",
    );
  });

  it.each([
    ["http://Storage.Example.invalid:80", "http://storage.example.invalid", "Storage.Example.invalid"],
    ["http://STORAGE.example.invalid:8333", "http://storage.example.invalid:8333", "STORAGE.example.invalid:8333"],
    ["https://Storage.Example.invalid:443", "https://storage.example.invalid", "Storage.Example.invalid"],
    ["https://storage.example.invalid:8333", "https://storage.example.invalid:8333", "storage.example.invalid:8333"],
  ])("downloads what was signed for %s with the host its signature covers", async (endpoint, origin, host) => {
    const url = presigned(endpoint, "/signed%2Fkey");
    const secure = endpoint.startsWith("https:");
    const policy = { ...route("/signed%2Fkey"), origin, ...(secure ? { port: tlsPort, ca: certificates.ca } : {}) };
    const content = await downloadArtifact(url, policy, new AbortController().signal);

    // The store took the signature: the host it was sent is the one that was signed, and the path and the
    // query are the ones of the URL, byte for byte.
    expect(JSON.parse(content.toString())).toEqual({ host, path: url.slice(endpoint.length) });
  });

  it("is refused by the store when the signature is of another writing of the host", async () => {
    // Signed for the host in capitals and written without them: the store is sent the host of the URL,
    // which is not the one the signature covers.
    const url = presigned("http://Storage.Example.invalid:8333", "/signed%2Fkey").replace(
      "Storage.Example",
      "storage.example",
    );

    await expect(downloadArtifact(url, route("/signed%2Fkey"), new AbortController().signal)).rejects.toMatchObject({
      code: "request-failed",
    });
  });
});

describe("the authorities a download trusts", () => {
  let other: Awaited<ReturnType<typeof createTlsFixture>>;
  let otherPort = 0;
  let otherServer: HttpsServer;

  // A second authority, and a store with a certificate of it.
  beforeAll(async () => {
    other = await createTlsFixture();
    otherServer = createHttpsServer(other, (_request, response) => response.end(gzipSync("of the other authority")));
    otherServer.listen(0, "127.0.0.1");
    await once(otherServer, "listening");
    otherPort = (otherServer.address() as AddressInfo).port;
  });
  afterAll(async () => {
    otherServer?.closeAllConnections();
    if (otherServer) await new Promise<void>((resolve) => otherServer.close(() => resolve()));
    await other?.dispose();
  });

  // What the host trusts, in place of what this machine does: the two lists the runtime gives of it. The
  // store of the system is not touched.
  const trusted = (lists: { default?: string[]; system?: string[] }) =>
    vi.spyOn(tls, "getCACertificates").mockImplementation((type) => lists[type as "default" | "system"] ?? []);
  const fetch = (at: number, ca?: string) => {
    const policy: ArtifactRoute = { ...route(), origin: "https://storage.example.invalid:8333", port: at, ca };

    return downloadArtifact(`${policy.origin}${policy.pathname}`, policy, new AbortController().signal);
  };

  it.each(["default", "system"] as const)(
    "accepts an authority that is only in the %s list of the host, with or without a certificate of the location",
    async (list) => {
      trusted({ [list]: [certificates.ca] });
      await expect(fetch(tlsPort)).resolves.toBeInstanceOf(Buffer);
      // The certificate of a location is added to what the host trusts, and takes nothing away from it.
      await expect(fetch(tlsPort, other.ca)).resolves.toBeInstanceOf(Buffer);
    },
  );

  it("accepts the certificate of the location beside what the host trusts, and alone", async () => {
    trusted({ default: [...tls.rootCertificates], system: [certificates.ca] });
    expect((await fetch(otherPort, other.ca)).toString()).toBe("of the other authority");
    trusted({});
    expect((await fetch(otherPort, other.ca)).toString()).toBe("of the other authority");
  });

  it("refuses an authority that neither the host nor the location names", async () => {
    trusted({ default: [...tls.rootCertificates], system: [certificates.ca] });
    await expect(fetch(otherPort)).rejects.toMatchObject({ code: "tls-invalid" });
    await expect(fetch(otherPort, certificates.ca)).rejects.toMatchObject({ code: "tls-invalid" });
    trusted({});
    await expect(fetch(tlsPort)).rejects.toMatchObject({ code: "tls-invalid" });
  });

  it("gives the roots of the runtime where the runtime cannot list what the host trusts", async () => {
    const runtime = tls as { getCACertificates?: typeof tls.getCACertificates };
    const lists = runtime.getCACertificates;
    const contexts = vi.spyOn(tls, "createSecureContext");

    // A runtime older than the function.
    runtime.getCACertificates = undefined;
    try {
      await expect(fetch(tlsPort, certificates.ca)).resolves.toBeInstanceOf(Buffer);
      await expect(fetch(tlsPort)).rejects.toMatchObject({ code: "tls-invalid" });
      // What each of the two connections was given to trust: the roots with the certificate of the
      // location, and nothing in place of what the runtime trusts by itself, which is more than its roots.
      expect(contexts.mock.calls.map(([options]) => options?.ca)).toEqual([
        [...tls.rootCertificates, certificates.ca],
        undefined,
      ]);
    } finally {
      runtime.getCACertificates = lists;
    }
  });
});

describe("the bytes of a download so far", () => {
  it("says how much of the text it has while the file arrives, and its whole size at the end", async () => {
    const seen: number[] = [];
    const content = await downloadArtifact(
      `${route().origin}/parts`,
      route("/parts"),
      new AbortController().signal,
      DOWNLOAD_LIMITS,
      (bytes) => seen.push(bytes),
    );

    expect(content.length).toBe(4096);
    // What is counted is the text as it will be read, not the bytes of the file: it grows, and ends at
    // the size of the text.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toEqual([...seen].sort((one, other) => one - other));
    expect(seen.at(-1)).toBe(4096);
    expect(seen[0]).toBeGreaterThan(0);
  });

  it("counts the text from its beginning, and not the part that arrived last", async () => {
    const seen: number[] = [];
    const content = await downloadArtifact(
      `${route().origin}/long`,
      route("/long"),
      new AbortController().signal,
      DOWNLOAD_LIMITS,
      (bytes) => seen.push(bytes),
    );

    // The text arrives in more parts than one, each as large as the decoder gives it: what is said after
    // each is all that arrived until then.
    expect(content.length).toBe(4 * DECODED_AT_ONCE);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((bytes, index) => index === 0 || bytes > seen[index - 1])).toBe(true);
    expect(seen.at(-1)).toBe(4 * DECODED_AT_ONCE);
  });

  it("downloads the same whether or not anything hears of its bytes, and whatever what hears of them does", async () => {
    const url = `${route().origin}/parts`;
    const signal = new AbortController().signal;
    const quiet = await downloadArtifact(url, route("/parts"), signal);
    const noisy = await downloadArtifact(url, route("/parts"), signal, DOWNLOAD_LIMITS, () => {
      throw new Error("what hears of the bytes fails");
    });

    expect(noisy.equals(quiet)).toBe(true);
    // A file beyond its bound ends as such, and what was counted of it is never beyond what was taken.
    const seen: number[] = [];

    await expect(
      downloadArtifact(
        `${route().origin}/large`,
        route("/large"),
        signal,
        { ...DOWNLOAD_LIMITS, decoded: 128 },
        (bytes) => seen.push(bytes),
      ),
    ).rejects.toMatchObject({ code: "payload-too-large" });
    expect(seen.every((bytes) => bytes <= 128)).toBe(true);
  });
});

describe("a failure of the connection, by where the connection was", () => {
  const tlsOrigin = "https://storage.example.invalid:8333";
  // A store with a certificate that has something wrong, and one that answers a request as it is given.
  const store = async (flaw: "purpose" | "expired") =>
    listening(createHttpsServer({ key: certificates.key, cert: await certificates.flawed(flaw) }));
  const answering = (answer: (request: IncomingMessage, response: ServerResponse) => void) =>
    listening(createHttpsServer(certificates, answer));
  // What takes the connection and is not a server of TLS.
  const taking = (take: (socket: Socket) => void) => listening(createListener(take));
  const trusting = () => ({ ca: certificates.ca });
  // Each failure with its code and, for a failure of TLS, whether it was the certificate that was refused.
  const failures: [string, DiagnosticCode, () => Promise<Partial<ArtifactRoute>>, "untrusted"?][] = [
    // Between the connection and the end of the handshake: TLS failed, whatever its code is called. A
    // certificate that was refused is told from a handshake that did not end.
    [
      "a certificate for another name",
      "tls-invalid",
      async () => ({ ...trusting(), port: tlsPort, origin: "https://wrong.example.invalid:8333" }),
      "untrusted",
    ],
    [
      "a certificate of an authority this side does not have",
      "tls-invalid",
      async () => ({ port: tlsPort }),
      "untrusted",
    ],
    [
      "a certificate for the purpose of a client",
      "tls-invalid",
      async () => ({ ...trusting(), port: await store("purpose") }),
      "untrusted",
    ],
    [
      "a certificate whose validity has ended",
      "tls-invalid",
      async () => ({ ...trusting(), port: await store("expired") }),
      "untrusted",
    ],
    [
      "a server that closes during the handshake",
      "tls-invalid",
      async () => ({ ...trusting(), port: await taking((socket) => socket.once("data", () => socket.destroy())) }),
    ],
    [
      "a server that resets the connection during the handshake",
      "tls-invalid",
      async () => ({
        ...trusting(),
        port: await taking((socket) => socket.once("data", () => socket.resetAndDestroy())),
      }),
    ],
    [
      "a server that answers the handshake with something else",
      "tls-invalid",
      async () => ({
        ...trusting(),
        port: await taking((socket) => socket.once("data", () => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"))),
      }),
    ],
    // Before the connection, and after the handshake: the store was not reached, or was lost.
    ["a port nothing listens on", "transport-unreachable", async () => ({ ...trusting(), port: await unused() })],
    [
      "a connection lost after the handshake",
      "transport-unreachable",
      async () => ({ ...trusting(), port: await answering((request) => request.socket.destroy()) }),
    ],
    [
      "a connection lost while the file arrives",
      "transport-unreachable",
      async () => ({
        ...trusting(),
        port: await answering((request, response) => {
          response.writeHead(200, { "Content-Length": 4096 });
          response.write(gzipSync("x".repeat(4096)).subarray(0, 8), () => request.socket.destroy());
        }),
      }),
    ],
    [
      "a connection without TLS lost while the file arrives",
      "transport-unreachable",
      async () => ({ origin: route().origin, pathname: "/broken" }),
    ],
    // Through a tunnel the connection that is made is the one to the listener of this process: one that
    // is lost before the handshake ends says nothing of TLS; a certificate that is refused does, and so
    // does a store that answers the handshake with what is not TLS.
    [
      "a tunnel that closes during the handshake",
      "transport-unreachable",
      async () => ({
        ...trusting(),
        mode: "tunnel",
        port: await taking((socket) => socket.once("data", () => socket.destroy())),
      }),
    ],
    [
      "a tunnel that resets the connection during the handshake",
      "transport-unreachable",
      async () => ({
        ...trusting(),
        mode: "tunnel",
        port: await taking((socket) => socket.once("data", () => socket.resetAndDestroy())),
      }),
    ],
    [
      "a certificate that is not trusted, through a tunnel",
      "tls-invalid",
      async () => ({ mode: "tunnel", port: tlsPort }),
      "untrusted",
    ],
    [
      "a certificate for the purpose of a client, through a tunnel",
      "tls-invalid",
      async () => ({ ...trusting(), mode: "tunnel", port: await store("purpose") }),
      "untrusted",
    ],
    [
      "a store that answers the handshake with something else, through a tunnel",
      "tls-invalid",
      async () => ({
        ...trusting(),
        mode: "tunnel",
        port: await taking((socket) => socket.once("data", () => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"))),
      }),
    ],
  ];

  it.each(failures)("ends %s as %s", async (_failure, code, stage, verdict) => {
    const policy: ArtifactRoute = { ...route(), origin: tlsOrigin, ...(await stage()) };
    const raised = await downloadArtifact(
      `${policy.origin}${policy.pathname}`,
      policy,
      new AbortController().signal,
    ).catch((error: unknown) => error);

    expect(raised).toMatchObject({ code });
    // Only a certificate that was refused is said as one.
    expect((raised as DiagnosticError).verdict).toBe(verdict);
  });

  // An error raised on the socket of a download while its handshake is made, with the name the system
  // gives it. The other side takes the connection and answers nothing.
  const raising = (name?: string, refused?: string) => {
    const make = https.request as (...given: unknown[]) => http.ClientRequest;

    vi.spyOn(https, "request").mockImplementation(((...given: unknown[]) => {
      const request = make(...given);

      request.once("socket", (socket) =>
        socket.once("connect", () => {
          // What the socket says of a certificate it refused.
          if (refused) Object.assign(socket, { authorizationError: refused });
          socket.destroy(Object.assign(new Error("raised by the test"), { code: name }));
        }),
      );
      return request;
    }) as typeof https.request);
    syncBuiltinESMExports();
  };
  const ended = async (mode: ArtifactRoute["mode"]) => {
    const policy: ArtifactRoute = {
      ...route(),
      ...trusting(),
      origin: tlsOrigin,
      mode,
      port: await taking((socket) => socket.resume()),
    };

    return downloadArtifact(`${policy.origin}${policy.pathname}`, policy, new AbortController().signal).then(
      () => {
        throw new Error("A download whose socket was destroyed ended with a file");
      },
      (error: unknown) => error as DiagnosticError,
    );
  };

  it.each(["ECONNRESET", "EPIPE", "ECONNABORTED", "ETIMEDOUT"])(
    "takes a connection lost with %s during the handshake as a store the tunnel did not reach, and as a failure of TLS without a tunnel",
    async (name) => {
      raising(name);
      expect(await ended("tunnel")).toMatchObject({ code: "transport-unreachable" });
      expect(await ended("test")).toMatchObject({ code: "tls-invalid" });
    },
  );

  it.each([undefined, "EPROTO", "ERR_SSL_WRONG_VERSION_NUMBER", "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION"])(
    "takes what else fails the handshake through a tunnel, as %s, for a failure of TLS and not of its certificate",
    async (name) => {
      raising(name);
      const raised = await ended("tunnel");

      expect(raised).toMatchObject({ code: "tls-invalid" });
      expect(raised.verdict).toBeUndefined();
    },
  );

  it("says a certificate that was refused through a tunnel, whatever the error that ends the connection is named", async () => {
    raising("ECONNRESET", "CERT_HAS_EXPIRED");
    expect(await ended("tunnel")).toMatchObject({ code: "tls-invalid", verdict: "untrusted" });
  });
});

describe("what a download leaves behind, however it ends", () => {
  const SENTINEL = "SENTINEL-OF-THE-SIGNED-URL";
  const query = `?X-Amz-Credential=${SENTINEL}&X-Amz-Signature=${SENTINEL}`;
  const tlsOrigin = "https://storage.example.invalid:8333";
  const bounds = (changed: Partial<DownloadLimits>): DownloadLimits => ({ ...DOWNLOAD_LIMITS, ...changed });
  // What the transport makes for a download, as it makes it: the request, the socket it is given and the
  // decoder. The lines of the console and of the two streams of the process are kept beside them.
  const observe = () => {
    const requests = [vi.spyOn(http, "request"), vi.spyOn(https, "request")];
    const decoders = vi.spyOn(zlib, "createGunzip");
    const lines = [
      ...(["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method)),
      vi.spyOn(process.stdout, "write"),
      vi.spyOn(process.stderr, "write"),
    ];

    syncBuiltinESMExports();
    return {
      // Whether each of them is closed.
      closed: () => {
        const made = requests.flatMap((spy) => spy.mock.results.map((result) => result.value as http.ClientRequest));

        return {
          requests: made.map((request) => request.destroyed),
          sockets: made.map((request) => request.socket?.destroyed ?? true),
          decoders: decoders.mock.results.map((result) => (result.value as zlib.Gunzip).destroyed),
        };
      },
      written: () =>
        lines
          .flatMap((spy) => spy.mock.calls.flat())
          .map((part) => (part instanceof Uint8Array ? Buffer.from(part).toString() : inspect(part, { depth: 8 })))
          .join("\n"),
    };
  };
  // Everything an error carries, with what it does not show by itself.
  const told = (value: unknown) =>
    `${inspect(value, { depth: 8, showHidden: true, getters: true })}\n${JSON.stringify(value)}\n${String(value)}`;
  // Whether every connection the listeners of the test took is closed, before the test closes any.
  const released = () =>
    Promise.race([
      Promise.all([...taken].map((socket) => (socket.destroyed ? undefined : once(socket, "close")))).then(
        () => "closed",
      ),
      delay(2000, "kept"),
    ]);
  // Each way a download ends, with what it ends as: its path on the store of the test or its own route,
  // its bounds, and what is done while it is in flight.
  const endings: [
    string,
    DiagnosticCode | "content",
    () => Promise<{
      path?: string;
      route?: Partial<ArtifactRoute>;
      limits?: DownloadLimits;
      during?: (controller: AbortController) => Promise<void>;
    }>,
  ][] = [
    ["a file", "content", async () => ({})],
    ["a file over TLS", "content", async () => ({ route: { origin: tlsOrigin, port: tlsPort, ca: certificates.ca } })],
    ["a file the store does not have", "artifact-missing", async () => ({ path: "/missing" })],
    ["an answer that sends elsewhere", "destination-denied", async () => ({ path: "/redirect" })],
    ["a refusal of the store", "request-failed", async () => ({ path: "/denied" })],
    ["a file that is not gzip", "artifact-invalid", async () => ({ path: "/invalid-gzip" })],
    ["a file found not to be gzip while it arrives", "artifact-invalid", async () => ({ path: "/invalid-parts" })],
    [
      "a file declared beyond the bound of the compressed bytes",
      "payload-too-large",
      async () => ({ path: "/large", limits: bounds({ compressed: 4 }) }),
    ],
    [
      "a file that arrives beyond the bound of the compressed bytes",
      "payload-too-large",
      async () => ({ path: "/parts", limits: bounds({ compressed: 4 }) }),
    ],
    [
      "a file beyond the bound of the decoded bytes",
      "payload-too-large",
      async () => ({ path: "/large", limits: bounds({ decoded: 128 }) }),
    ],
    [
      "a connection that is not made within its bound",
      "deadline",
      async () => ({
        // The connection is taken, what it is sent is read, and the handshake is never answered.
        route: {
          origin: tlsOrigin,
          port: await listening(createListener((socket) => socket.resume())),
          ca: certificates.ca,
        },
        limits: bounds({ connectMs: 250 }),
      }),
    ],
    [
      "an answer that does not come within the bound of the silence",
      "deadline",
      async () => ({ path: "/waiting", limits: bounds({ idleMs: 250 }) }),
    ],
    [
      "an answer that does not come within the bound of the whole",
      "deadline",
      async () => ({ path: "/waiting", limits: bounds({ totalMs: 250 }) }),
    ],
    [
      "a cancellation",
      "cancelled",
      async () => {
        const arrived = once(server, "request");

        return {
          path: "/waiting",
          during: async (controller) => {
            await arrived;
            controller.abort();
          },
        };
      },
    ],
    ["a connection that is refused", "transport-unreachable", async () => ({ route: { port: await unused() } })],
    ["a connection lost while the file arrives", "transport-unreachable", async () => ({ path: "/broken" })],
    ["a certificate that is not trusted", "tls-invalid", async () => ({ route: { origin: tlsOrigin, port: tlsPort } })],
  ];

  it.each(endings)(
    "closes the socket, the decoder and the request after %s, and says nothing of the URL",
    async (_ending, expected, stage) => {
      const observed = observe();
      const { path = "/artifact%2Fkey", route: changed, limits, during } = await stage();
      const policy: ArtifactRoute = { ...route(path), ...changed };
      const controller = new AbortController();
      const pending = downloadArtifact(`${policy.origin}${path}${query}`, policy, controller.signal, limits).then(
        (content) => ({ content }),
        (error: unknown) => ({ error }),
      );

      await during?.(controller);
      const outcome = await pending;

      if (expected === "content") expect(outcome).toMatchObject({ content: expect.any(Buffer) });
      else
        expect(outcome).toMatchObject({
          error: { code: expected, message: `Diagnostic operation failed: ${expected}` },
        });
      // One request, one socket and one decoder were made, and none is left open; the store sees its side
      // of the connection closed.
      expect(observed.closed()).toEqual({ requests: [true], sockets: [true], decoders: [true] });
      expect(await released()).toBe("closed");
      if ("error" in outcome) expect(told(outcome.error)).not.toContain(SENTINEL);
      expect(observed.written()).not.toContain(SENTINEL);
    },
  );

  it("says nothing of the URL when it refuses it before any connection", () => {
    const observed = observe();
    const url = `${route().origin}${route().pathname}${query}`;
    const refusals = [
      // Another origin, a destination that is refused, a bound that is not one, and a text that is no URL.
      () => downloadArtifact(url, { ...route(), origin: "http://elsewhere.invalid" }, new AbortController().signal),
      () => downloadArtifact(url, { ...route(), address: "169.254.169.254" }, new AbortController().signal),
      () => downloadArtifact(url, route(), new AbortController().signal, bounds({ totalMs: 0 })),
      () => downloadArtifact(`http://[${SENTINEL}${query}`, route(), new AbortController().signal),
      () => validateArtifactRoute(`${url}#${SENTINEL}`, route()),
    ].map((refused) => {
      try {
        refused();
      } catch (error) {
        return error;
      }
      return undefined;
    });

    expect(refusals).toMatchObject([
      { code: "destination-denied" },
      { code: "destination-denied" },
      { code: "validation" },
      { code: "destination-denied" },
      { code: "destination-denied" },
    ]);
    expect(told(refusals)).not.toContain(SENTINEL);
    expect(observed.closed()).toEqual({ requests: [], sockets: [], decoders: [] });
    expect(observed.written()).not.toContain(SENTINEL);
  });

  it("says nothing of the URL of a download that was cancelled before it began", async () => {
    const observed = observe();
    const controller = new AbortController();

    controller.abort();
    const error = await downloadArtifact(
      `${route().origin}${route().pathname}${query}`,
      route(),
      controller.signal,
    ).catch((failure: unknown) => failure);

    expect(error).toMatchObject({ code: "cancelled" });
    expect(told(error)).not.toContain(SENTINEL);
    expect(observed.closed()).toEqual({ requests: [], sockets: [], decoders: [] });
    expect(observed.written()).not.toContain(SENTINEL);
  });
});
