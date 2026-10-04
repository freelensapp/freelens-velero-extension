import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import tls from "node:tls";
import { createGunzip } from "node:zlib";
import { canonicalAddress, classifyAddress, isMetadataName } from "../common/artifact-address";

import type { DownloadVerdict } from "../common/diagnostic-text";

export type DiagnosticCode =
  | "validation"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "cancelled"
  | "deadline"
  | "submission-unknown"
  | "artifact-missing"
  | "artifact-invalid"
  | "transport-unreachable"
  | "tls-invalid"
  | "destination-denied"
  | "payload-too-large"
  | "request-failed"
  | "target-changed";

// A way an operation ends that is not its result: a code, and the step it ended at when what raised it
// knows it. Its message is the code and nothing of what caused it.
export class DiagnosticError extends Error {
  constructor(
    readonly code: DiagnosticCode,
    readonly stage?: string,
    // What the way of a request found by itself, where the code alone does not say it.
    readonly verdict?: DownloadVerdict,
  ) {
    super(`Diagnostic operation failed: ${code}`);
    this.name = "DiagnosticError";
  }
}

export interface ArtifactRoute {
  origin: string;
  pathname: string;
  address: string;
  port: number;
  mode: "direct" | "tunnel" | "test";
  allowHttp?: boolean;
  allowPrivate?: boolean;
  ca?: string;
}

export const DOWNLOAD_LIMITS = {
  compressed: 16 * 1024 ** 2,
  decoded: 64 * 1024 ** 2,
  connectMs: 10_000,
  idleMs: 15_000,
  totalMs: 120_000,
} as const;
export type DownloadLimits = { [Key in keyof typeof DOWNLOAD_LIMITS]: number };

// The ways a route reaches its address.
const MODES: readonly unknown[] = ["direct", "tunnel", "test"];
// The names the system has for a connection that was lost.
const LOST = ["ECONNRESET", "EPIPE", "ECONNABORTED", "ETIMEDOUT"];

// What a download is sent with, once its URL and its route are allowed: the name of the host, for TLS;
// the host and the target as the URL writes them, which are what its signature covers; and the address
// of the route in its canonical form, which is what the socket is given.
export function validateArtifactRoute(
  raw: string,
  route: ArtifactRoute,
): { hostname: string; host: string; target: string; secure: boolean; address: string } {
  try {
    if (raw.length > 8192 || /[^\x21-\x7e]/.test(raw)) throw new DiagnosticError("destination-denied");
    const parsed = new URL(raw);
    // The scheme, the host, the port where one is written, and the path with its query.
    const parts = /^(https?):\/\/([^/?#:@[\]]+|\[[^/?#@[\]]+\])(?::(\d+))?(\/[^#]*)$/.exec(raw);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    const usual = parsed.protocol === "https:" ? "443" : "80";
    const address = canonicalAddress(route.address);
    const kind = classifyAddress(route.address);

    // The host is the one of the origin whatever its capitals, and the port with or without the one of
    // the scheme written: nothing else a parser reads as the same origin is taken for it.
    if (
      !parts ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== route.origin ||
      parsed.pathname !== route.pathname ||
      parts[2].toLowerCase() !== parsed.hostname ||
      (parts[3] !== usual && (parts[3] ?? "") !== parsed.port) ||
      parts[4] !== `${parsed.pathname}${parsed.search}`
    )
      throw new DiagnosticError("destination-denied");
    // A host that is itself an address is refused when the address is, and so is the name of a metadata
    // service.
    if ((canonicalAddress(hostname) && classifyAddress(hostname) === "refused") || isMetadataName(hostname))
      throw new DiagnosticError("destination-denied");
    // An IPv4 address on a socket of IPv6 is not taken as the address of a route, whatever it carries.
    if (
      !address ||
      kind === "refused" ||
      address.startsWith("::ffff:") ||
      !Number.isInteger(route.port) ||
      route.port < 1 ||
      route.port > 65535
    )
      throw new DiagnosticError("destination-denied");
    // A route is direct, through a tunnel or to a server of a test, and nothing else. A tunnel and a
    // server of a test are on the loopback of this machine; a direct route never is.
    if (!MODES.includes(route.mode) || (route.mode === "direct") === (kind === "loopback"))
      throw new DiagnosticError("destination-denied");
    if (kind === "private" && !route.allowPrivate) throw new DiagnosticError("destination-denied");
    if (parsed.protocol === "http:" && !route.allowHttp) throw new DiagnosticError("destination-denied");
    // The host a store is sent is the one its signer signed: the host as the URL writes it, capitals
    // included, and without the port when it is the one of the scheme, which a signer leaves out.
    return {
      hostname,
      host: parts[3] === undefined || parts[3] === usual ? parts[2] : `${parts[2]}:${parts[3]}`,
      target: parts[4],
      secure: parsed.protocol === "https:",
      address,
    };
  } catch {
    throw new DiagnosticError("destination-denied");
  }
}

// The authorities a download trusts: the ones the host trusts, as the host lists them for its own
// requests, which are the ones of the runtime, with the ones NODE_EXTRA_CA_CERTS names, and the ones of
// the system; and the certificate of the location beside them. A runtime older than the function that
// lists them is left to trust what it trusts by itself where the location gives no certificate, and is
// given its roots with the certificate where the location gives one.
function authorities(certificate?: string): string[] | undefined {
  const beside = certificate ? [certificate] : [];

  if (typeof tls.getCACertificates === "function")
    return [...tls.getCACertificates("default"), ...tls.getCACertificates("system"), ...beside];
  return certificate ? [...tls.rootCertificates, ...beside] : undefined;
}

export function downloadArtifact(
  raw: string,
  route: ArtifactRoute,
  signal: AbortSignal,
  limits: DownloadLimits = DOWNLOAD_LIMITS,
): Promise<Buffer> {
  const validated = validateArtifactRoute(raw, route);
  for (const key of Object.keys(DOWNLOAD_LIMITS) as (keyof DownloadLimits)[]) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0 || limits[key] > DOWNLOAD_LIMITS[key])
      throw new DiagnosticError("validation");
  }
  if (signal.aborted) return Promise.reject(new DiagnosticError("cancelled"));

  return new Promise((resolve, reject) => {
    let settled = false;
    let response: import("node:http").IncomingMessage | undefined;
    // Where the connection is: not made, made and before the end of the handshake of TLS, or open.
    let connection: "none" | "handshake" | "open" = "none";
    const decoder = createGunzip();
    const chunks: Buffer[] = [];
    let compressed = 0;
    let decoded = 0;
    const request = (validated.secure ? httpsRequest : httpRequest)({
      protocol: validated.secure ? "https:" : "http:",
      hostname: validated.address,
      port: route.port,
      method: "GET",
      path: validated.target,
      headers: { Host: validated.host, "Accept-Encoding": "identity" },
      agent: false,
      ...(validated.secure
        ? {
            servername: isIP(validated.hostname) ? undefined : validated.hostname,
            rejectUnauthorized: true,
            ca: authorities(route.ca),
            checkServerIdentity: (_hostname: string, certificate: import("node:tls").PeerCertificate) =>
              tls.checkServerIdentity(validated.hostname, certificate),
          }
        : {}),
    });
    const finish = (error?: DiagnosticError, content?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
      signal.removeEventListener("abort", abort);
      request.destroy();
      response?.destroy();
      decoder.destroy();
      chunks.length = 0;
      if (error) reject(error);
      else resolve(content ?? Buffer.alloc(0));
    };
    const abort = () => finish(new DiagnosticError("cancelled"));
    const connectTimer = setTimeout(() => finish(new DiagnosticError("deadline")), limits.connectMs);
    const totalTimer = setTimeout(() => finish(new DiagnosticError("deadline")), limits.totalMs);

    signal.addEventListener("abort", abort, { once: true });
    request.on("socket", (socket) => {
      socket.once("connect", () => {
        connection = validated.secure ? "handshake" : "open";
        if (!validated.secure) clearTimeout(connectTimer);
      });
      socket.once("secureConnect", () => {
        connection = "open";
        clearTimeout(connectTimer);
      });
    });
    request.setTimeout(limits.idleMs, () => finish(new DiagnosticError("deadline")));
    // What a failure of the connection is, by where the connection was: before it was made the store was
    // not reached; from then to the end of the handshake TLS failed; after it the connection was lost. A
    // certificate that was refused, which the socket says, is told from a handshake that did not end.
    // Through a tunnel the connection that is made is the one to the listener of this process, which says
    // nothing of the store: there a connection the system says was lost is a store the tunnel did not
    // reach, and what else fails the handshake is of TLS, as a store that answers it with something else.
    request.once("error", (error: NodeJS.ErrnoException) => {
      const refused = Boolean((request.socket as import("node:tls").TLSSocket | null)?.authorizationError);
      const lost = route.mode === "tunnel" && LOST.includes(error?.code ?? "");

      if (connection !== "handshake" || (lost && !refused)) finish(new DiagnosticError("transport-unreachable"));
      else finish(new DiagnosticError("tls-invalid", undefined, refused ? "untrusted" : undefined));
    });
    request.once("response", (incoming) => {
      response = incoming;
      if (incoming.statusCode !== 200) {
        finish(
          new DiagnosticError(
            incoming.statusCode === 404
              ? "artifact-missing"
              : incoming.statusCode && incoming.statusCode >= 300 && incoming.statusCode < 400
                ? "destination-denied"
                : "request-failed",
          ),
        );
        return;
      }
      if (Number(incoming.headers["content-length"]) > limits.compressed) {
        finish(new DiagnosticError("payload-too-large"));
        return;
      }
      const compressedBound = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          compressed += chunk.length;
          callback(compressed > limits.compressed ? new DiagnosticError("payload-too-large") : null, chunk);
        },
      });
      const collector = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          decoded += chunk.length;
          if (decoded > limits.decoded) callback(new DiagnosticError("payload-too-large"));
          else {
            chunks.push(chunk);
            callback();
          }
        },
      });

      // An answer that fails before anything that reads it does is a connection lost while the file
      // arrives, and not a file that cannot be read.
      let lost = false;

      incoming.once("error", () => {
        lost = !compressedBound.errored && !decoder.errored && !collector.errored;
      });
      pipeline(incoming, compressedBound, decoder, collector)
        .then(() => finish(undefined, Buffer.concat(chunks, decoded)))
        .catch((error: unknown) =>
          finish(
            error instanceof DiagnosticError
              ? error
              : new DiagnosticError(lost ? "transport-unreachable" : "artifact-invalid"),
          ),
        );
    });
    if (signal.aborted) abort();
    else request.end();
  });
}
