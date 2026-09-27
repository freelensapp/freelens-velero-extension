import { once } from "node:events";
import { createServer } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import type { TLSSocket } from "node:tls";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTlsFixture } from "../../test/tls-fixture";
import { type ArtifactRoute, DOWNLOAD_LIMITS, downloadArtifact, validateArtifactRoute } from "./diagnostic-transport";

const server = createServer((request, response) => {
  if (request.url?.startsWith("/missing")) {
    response.writeHead(404).end();
    return;
  }
  if (request.url?.startsWith("/redirect")) {
    response.writeHead(302, { Location: "http://169.254.169.254/" }).end();
    return;
  }
  if (request.url?.startsWith("/waiting")) return;
  if (request.url?.startsWith("/invalid-gzip")) {
    response.end("not-gzip");
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

beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  if (!address || typeof address === "string") throw new Error("Missing test listener");
  port = address.port;
  certificates = await createTlsFixture();
  tlsServer = createHttpsServer(certificates, (request, response) => {
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
  tlsServer.listen(0, "127.0.0.1");
  await once(tlsServer, "listening");
  const tlsAddress = tlsServer.address();

  if (!tlsAddress || typeof tlsAddress === "string") throw new Error("Missing TLS test listener");
  tlsPort = tlsAddress.port;
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

  it.each([
    "169.254.169.254",
    "0.0.0.0",
    "224.0.0.1",
    "::ffff:169.254.169.254",
    "fe80::1",
  ])("denies metadata and invalid destinations: %s", (address) => {
    expect(() =>
      validateArtifactRoute(`${route().origin}${route().pathname}`, { ...route(), address, allowPrivate: true }),
    ).toThrow("destination-denied");
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
