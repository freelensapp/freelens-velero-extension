import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { checkServerIdentity, rootCertificates } from "node:tls";
import { createGunzip } from "node:zlib";

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

export class DiagnosticError extends Error {
  constructor(readonly code: DiagnosticCode) {
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

const denied = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["169.254.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  denied.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  denied.addSubnet(address, prefix, "ipv6");
const privateAddresses = new BlockList();
for (const [address, prefix] of [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["100.64.0.0", 10],
  ["198.18.0.0", 15],
] as const)
  privateAddresses.addSubnet(address, prefix, "ipv4");
privateAddresses.addSubnet("fc00::", 7, "ipv6");

export function validateArtifactRoute(
  raw: string,
  route: ArtifactRoute,
): { hostname: string; host: string; target: string; secure: boolean } {
  try {
    if (raw.length > 8192 || /[^\x21-\x7e]/.test(raw)) throw new DiagnosticError("destination-denied");
    const parsed = new URL(raw);
    const parts = /^(https?):\/\/([^/?#]+)(\/[^#]*)$/.exec(raw);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    const family = isIP(route.address);
    const mapped = family === 6 && new URL(`http://[${route.address}]/`).hostname.startsWith("[::ffff:");
    const loopback = route.address === "::1" || (family === 4 && route.address.startsWith("127."));
    const kind = family === 4 ? "ipv4" : "ipv6";
    const originFamily = isIP(hostname);

    if (
      !parts ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== route.origin ||
      parsed.pathname !== route.pathname ||
      parts[2] !== parsed.host ||
      parts[3] !== `${parsed.pathname}${parsed.search}`
    )
      throw new DiagnosticError("destination-denied");
    if (
      (originFamily && denied.check(hostname, originFamily === 4 ? "ipv4" : "ipv6")) ||
      hostname === "metadata.google.internal"
    )
      throw new DiagnosticError("destination-denied");
    if (
      !family ||
      mapped ||
      denied.check(route.address, kind) ||
      !Number.isInteger(route.port) ||
      route.port < 1 ||
      route.port > 65535
    )
      throw new DiagnosticError("destination-denied");
    if (
      (loopback && route.mode === "direct") ||
      (route.mode === "tunnel" && !loopback) ||
      (!loopback && privateAddresses.check(route.address, kind) && !route.allowPrivate)
    )
      throw new DiagnosticError("destination-denied");
    if (parsed.protocol === "http:" && !route.allowHttp) throw new DiagnosticError("destination-denied");
    return { hostname, host: parts[2], target: parts[3], secure: parsed.protocol === "https:" };
  } catch {
    throw new DiagnosticError("destination-denied");
  }
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
    const decoder = createGunzip();
    const chunks: Buffer[] = [];
    let compressed = 0;
    let decoded = 0;
    const request = (validated.secure ? httpsRequest : httpRequest)({
      protocol: validated.secure ? "https:" : "http:",
      hostname: route.address,
      port: route.port,
      method: "GET",
      path: validated.target,
      headers: { Host: validated.host, "Accept-Encoding": "identity" },
      agent: false,
      ...(validated.secure
        ? {
            servername: isIP(validated.hostname) ? undefined : validated.hostname,
            rejectUnauthorized: true,
            ca: route.ca ? [...rootCertificates, route.ca] : undefined,
            checkServerIdentity: (_hostname: string, certificate: import("node:tls").PeerCertificate) =>
              checkServerIdentity(validated.hostname, certificate),
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
      socket.once(validated.secure ? "secureConnect" : "connect", () => clearTimeout(connectTimer));
    });
    request.setTimeout(limits.idleMs, () => finish(new DiagnosticError("deadline")));
    request.once("error", (error: NodeJS.ErrnoException) => {
      const tlsError = /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO/.test(error.code ?? "");

      finish(new DiagnosticError(tlsError ? "tls-invalid" : "transport-unreachable"));
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

      pipeline(incoming, compressedBound, decoder, collector)
        .then(() => finish(undefined, Buffer.concat(chunks, decoded)))
        .catch((error: unknown) =>
          finish(error instanceof DiagnosticError ? error : new DiagnosticError("artifact-invalid")),
        );
    });
    if (signal.aborted) abort();
    else request.end();
  });
}
