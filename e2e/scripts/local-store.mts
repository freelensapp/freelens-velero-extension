import { createHash, createHmac } from "node:crypto";
import { requireCondition } from "./local-kind.mts";
import { type Credentials, STORAGE_ENDPOINT } from "./local-manifests.mts";

// The ways a request gives the store a body, in the order they are tried by the first request that carries
// one: a way is tried only when the ones before it failed, and the way that passed is the way of every file
// after it. In the first two the client signs the request itself: it is given the body as a file to upload,
// or as the data of the request. In the third the request is signed here, over the digest of the body, and
// the client sends it as it is. The store the environment pins, SeaweedFS 4.48, takes all three, and holds
// the whole length it was sent in each: the first is the one its files are sent in. A store of another
// version is found out by the first file that is written.
export const STORE_WAYS = ["upload", "data", "signed"] as const;
export type StoreWay = (typeof STORE_WAYS)[number];

// The body of a request to the store: the bytes of one key, and the way they are sent.
export interface StoreBody {
  bytes: Uint8Array;
  way: StoreWay;
}

// What the store answered: its code, its headers by their names in lower case, and what it sent.
export interface StoreAnswer {
  code: number;
  headers: Record<string, string[]>;
  bytes: Uint8Array;
}

// Where the node keeps the body of a request while it is sent: one file, which the next request writes
// over, and which is removed after each.
export const STORE_BODY_FILE = "/tmp/velero-fixture-store-body";

const REGION = "us-east-1";
const SIGNED_HEADERS = "host;x-amz-content-sha256;x-amz-date";

// What says who sends a request that carries a body, when the client is not asked to sign it: the
// signature of version 4 of a write to S3 whose payload is named by its digest, over the three headers the
// request is sent with. The key of the identity signs, and is in nothing that is sent.
export function storeAuthorization(request: { path: string; sha256: string; credentials: Credentials; at: Date }): {
  date: string;
  authorization: string;
} {
  const { path, sha256, credentials, at } = request;

  // A key is signed as it is sent: one with a character that is sent in another form is not signed here.
  requireCondition(/^\/[A-Za-z0-9/._-]+$/.test(path), "The key of a signed request is sent as it is written");
  requireCondition(/^[a-f0-9]{64}$/.test(sha256), "The digest of the body of a signed request is required");
  requireCondition(credentials.accessKey && credentials.secretKey, "A signed request is of an identity of the store");
  requireCondition(Number.isFinite(at.getTime()), "The time a request is signed at is required");
  const date = at.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const scope = `${date.slice(0, 8)}/${REGION}/s3/aws4_request`;
  const asked = [
    "PUT",
    path,
    "",
    `host:${new URL(STORAGE_ENDPOINT).host}`,
    `x-amz-content-sha256:${sha256}`,
    `x-amz-date:${date}`,
    "",
    SIGNED_HEADERS,
    sha256,
  ].join("\n");
  const keyed = (key: string | Buffer, text: string) => createHmac("sha256", key).update(text).digest();
  const key = scope.split("/").reduce<string | Buffer>(keyed, `AWS4${credentials.secretKey}`);
  const signature = keyed(
    key,
    ["AWS4-HMAC-SHA256", date, scope, createHash("sha256").update(asked).digest("hex")].join("\n"),
  ).toString("hex");

  return {
    date,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKey}/${scope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`,
  };
}

// What the log of the operations says of a request to the store the client was told to send: its verb, its
// key, what the store answered, the length the store says it holds of a key it was asked for, and for a body
// its length and the way it was sent. No setting of the client is among them: the settings carry the
// identity. A request the store did not answer is told too. The length is told of a key the store holds: for
// one it does not hold it answers with a text of its own, and the length it says is the one of that text.
export function storeLogLine(request: {
  method: string;
  path: string;
  // The code the store answered, when it answered.
  code?: number;
  body?: { way: StoreWay; bytes: number };
  // The length the store says it holds of the key, as it says it.
  held?: string;
}): string {
  const { method, path, code, body, held } = request;

  return `${[
    `store ${method} ${path}: ${code ?? "no answer"}`,
    ...(body ? [`${body.bytes} bytes sent as ${body.way}`] : []),
    ...(code === 200 && held !== undefined && /^\d+$/.test(held) ? [`${held} bytes held`] : []),
  ].join(", ")}\n`;
}

// What the client inside the node is told of a request to the store, one setting a line, on its standard
// input: the credentials are in no argument. A request without a body is asked as it always was. One with a
// body names the file the node keeps it in, has a minute where the others have ten seconds, and is of an
// identity of the store: nothing is written without one.
export function storeSettings(request: {
  method: "GET" | "PUT" | "HEAD";
  path: string;
  // The address of the Service of the store, which its name is resolved to.
  address: string;
  credentials?: Credentials;
  body?: { way: StoreWay; sha256: string };
  // When the request is signed, if it is signed here.
  at?: Date;
}): string[] {
  const { method, path, address, credentials, body, at } = request;
  const endpoint = new URL(STORAGE_ENDPOINT);
  const settings = [
    "silent",
    "show-error",
    "connect-timeout = 3",
    `max-time = ${body ? 60 : 10}`,
    'proto = "=http"',
    `url = ${JSON.stringify(`${STORAGE_ENDPOINT}${path}`)}`,
    `resolve = ${JSON.stringify(`${endpoint.hostname}:${endpoint.port}:${address}`)}`,
    ...(method === "HEAD" ? [] : ["max-filesize = 16777216"]),
    `write-out = ${JSON.stringify('\nFV_HTTP_META:{"code":%{response_code},"headers":%{header_json}}')}`,
    method === "HEAD" ? "head" : `request = ${JSON.stringify(method)}`,
  ];
  const signs = () =>
    credentials
      ? [
          `aws-sigv4 = ${JSON.stringify(`aws:amz:${REGION}:s3`)}`,
          `user = ${JSON.stringify(`${credentials.accessKey}:${credentials.secretKey}`)}`,
        ]
      : [];

  if (!body) return [...settings, ...signs()];
  requireCondition(method === "PUT" && credentials, "A body is written by an identity of the store");
  requireCondition(STORE_WAYS.includes(body.way), "A body is sent in a way the client of the store knows");
  if (body.way === "upload") return [...settings, `upload-file = ${JSON.stringify(STORE_BODY_FILE)}`, ...signs()];
  if (body.way === "data") {
    return [
      ...settings,
      `data-binary = ${JSON.stringify(`@${STORE_BODY_FILE}`)}`,
      // Without it the client says that the data is a form.
      'header = "Content-Type: application/octet-stream"',
      ...signs(),
    ];
  }
  requireCondition(at, "The time a request is signed at is required");
  const signed = storeAuthorization({ path, sha256: body.sha256, credentials, at });

  return [
    ...settings,
    `upload-file = ${JSON.stringify(STORE_BODY_FILE)}`,
    `header = ${JSON.stringify(`x-amz-content-sha256: ${body.sha256}`)}`,
    `header = ${JSON.stringify(`x-amz-date: ${signed.date}`)}`,
    `header = ${JSON.stringify(`Authorization: ${signed.authorization}`)}`,
  ];
}
