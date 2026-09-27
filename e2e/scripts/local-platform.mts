import { createHash } from "node:crypto";

export type NetworkShape = "internal" | "loopback";
export type ImagePlatform = "linux/amd64" | "linux/arm64";
export type BinaryTarget = "linux-amd64" | "linux-arm64" | "darwin-amd64" | "darwin-arm64";

export interface DockerInfo {
  OSType: string;
  Architecture: string;
  NCPU: number;
  MemTotal: number;
  OperatingSystem?: string;
}

const GIBIBYTE = 1024 ** 3;

export const NODE_PROCESSORS = 4;
export const NODE_MEMORY = { wanted: 8 * GIBIBYTE, least: 6 * GIBIBYTE };

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function imagePlatform(info: Pick<DockerInfo, "OSType" | "Architecture">): ImagePlatform {
  check(info.OSType === "linux", "The Docker daemon must run Linux containers");
  if (info.Architecture === "x86_64" || info.Architecture === "amd64") return "linux/amd64";
  if (info.Architecture === "aarch64" || info.Architecture === "arm64") return "linux/arm64";
  throw new Error(`Unsupported Docker architecture: ${info.Architecture}`);
}

export function imageArchitecture(platform: ImagePlatform): "amd64" | "arm64" {
  return platform === "linux/amd64" ? "amd64" : "arm64";
}

export interface ImageIndex {
  manifests?: { digest: string; platform?: { os?: string; architecture?: string } }[];
}

const DIGEST = /^sha256:[a-f0-9]{64}$/;

// The manifest of one platform inside a pinned index, which must have one and only one.
export function platformManifest(name: string, index: ImageIndex, platform: ImagePlatform): string {
  const found = (index.manifests ?? []).filter(
    (manifest) => `${manifest.platform?.os}/${manifest.platform?.architecture}` === platform,
  );

  check(
    found.length === 1 && DIGEST.test(found[0].digest),
    `The pin of the ${name} image is not an index with ${platform}`,
  );
  return found[0].digest;
}

// A pin serves every supported platform or it is not accepted on any.
export function assertIndexPlatforms(name: string, index: ImageIndex): void {
  platformManifest(name, index, "linux/amd64");
  platformManifest(name, index, "linux/arm64");
}

export interface EngineImage {
  Descriptor?: { digest?: string };
  Manifests?: { Kind?: string; Descriptor?: { digest?: string; platform?: { os?: string; architecture?: string } } }[];
}

// The index as the engine holds it, when it does: the containerd image store keeps it, the classic one does not.
export function engineIndex(pinned: string, image: EngineImage | undefined): ImageIndex | undefined {
  if (image?.Descriptor?.digest !== pinned || !image.Manifests?.length) return undefined;
  return {
    manifests: image.Manifests.filter((manifest) => manifest.Kind === "image").map((manifest) => ({
      digest: manifest.Descriptor?.digest ?? "",
      platform: manifest.Descriptor?.platform,
    })),
  };
}

// The pins whose index was read once: a digest names one content, so what was true of it stays true.
export function verifiedPins(content: string | undefined): string[] {
  try {
    const pins: unknown = JSON.parse(content ?? "[]");

    return Array.isArray(pins) ? pins.filter((pin) => typeof pin === "string" && DIGEST.test(pin)) : [];
  } catch {
    return [];
  }
}

// The host reaches the address of the node on Linux only, and not when Docker runs in a virtual machine there.
export function networkShape(host: NodeJS.Platform, info: Pick<DockerInfo, "OperatingSystem">): NetworkShape {
  return host === "linux" && !/docker desktop/i.test(info.OperatingSystem ?? "") ? "internal" : "loopback";
}

// The memory the node is limited to: what is wanted, or what the daemon has when it has less.
export function nodeMemory(info: Pick<DockerInfo, "NCPU" | "MemTotal">): number {
  check(
    Number.isInteger(info.NCPU) && info.NCPU >= NODE_PROCESSORS,
    `Docker needs ${NODE_PROCESSORS} processors or more`,
  );
  check(Number.isSafeInteger(info.MemTotal) && info.MemTotal > 0, "Docker reports no memory");
  const megabytes = Math.floor(Math.min(NODE_MEMORY.wanted, info.MemTotal) / 1024 ** 2);

  check(megabytes * 1024 ** 2 >= NODE_MEMORY.least, "Docker needs 6 GiB of memory or more");
  return megabytes;
}

export const BINARIES = {
  kind: {
    version: "0.33.0",
    checksums: {
      "linux-amd64": "aee6151561422756b764a4ae28e7f44cda5af5a9eead3cc9985112b1de8d8e0d",
      "linux-arm64": "20022bee6cfcd5086cb7234d218e3454e6090022f2a8f55d1fa7fcf42c3867a2",
      "darwin-amd64": "5a99f26f57246dc9319dd294803313197a0f34d33c525b3ea8b655db5916ece0",
      "darwin-arm64": "0c8c7dbe5e23594a198b786c4bc13dacc101fa6196b0cb0b23a1ca44e61f4b4f",
    },
  },
  kubectl: {
    version: "1.33.4",
    checksums: {
      "linux-amd64": "c2ba72c115d524b72aaee9aab8df8b876e1596889d2f3f27d68405262ce86ca1",
      "linux-arm64": "76cd7a2aa59571519b68c3943521404cbce55dafb7d8866f8d0ea2995b396eef",
      "darwin-amd64": "4b39b8bb12e78ce801b39c9ec50421e3d6e144d8e3f113cd18e6d61709b8c73b",
      "darwin-arm64": "a44662db083fdd1b19ce55ba77eb64d51206310bbae90df90eb5d9e30ea54603",
    },
  },
} as const satisfies Record<string, { version: string; checksums: Record<BinaryTarget, string> }>;

export type BinaryName = keyof typeof BINARIES;

export function binaryTarget(host: NodeJS.Platform, architecture: string): BinaryTarget {
  check(host === "linux" || host === "darwin", `Unsupported host system: ${host}`);
  check(architecture === "x64" || architecture === "arm64", `Unsupported host architecture: ${architecture}`);
  return `${host}-${architecture === "x64" ? "amd64" : "arm64"}`;
}

export function binaryUrl(name: BinaryName, target: BinaryTarget): string {
  const { version } = BINARIES[name];

  return name === "kind"
    ? `https://github.com/kubernetes-sigs/kind/releases/download/v${version}/kind-${target}`
    : `https://dl.k8s.io/release/v${version}/bin/${target.replace("-", "/")}/kubectl`;
}

export function assertBinary(name: BinaryName, target: BinaryTarget, content: Uint8Array): void {
  check(
    createHash("sha256").update(content).digest("hex") === BINARIES[name].checksums[target],
    `The downloaded ${name} does not match its pinned checksum`,
  );
}

// What a child process may inherit. Everything else of the caller stays with the caller.
const INHERITED = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "TMPDIR"];

export function childEnvironment(base: NodeJS.ProcessEnv, own: Record<string, string>): Record<string, string> {
  const environment: Record<string, string> = {};

  for (const key of INHERITED) {
    const value = base[key];

    if (value !== undefined) environment[key] = value;
  }
  return { ...environment, ...own };
}

export function dockerSocket(candidates: string[], isSocket: (path: string) => boolean): string {
  const found = candidates.find((path) => path.startsWith("/") && isSocket(path));

  check(found, "No local Docker socket was found");
  return `unix://${found}`;
}

const TOKEN = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
const WITHHELD = "withheld";
const CREDENTIALS = ["client-key-data", "client-certificate-data", "token", "password"];

function withholdValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withholdValue);
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value as Record<string, unknown>);
  const secret = (value as { kind?: unknown }).kind === "Secret";

  return Object.fromEntries(
    entries.map(([key, inner]) => {
      if (secret && (key === "data" || key === "stringData")) return [key, WITHHELD];
      if (CREDENTIALS.includes(key) && typeof inner === "string") return [key, WITHHELD];
      // The annotation of a client-side apply repeats the whole object, its body included.
      if (key === "kubectl.kubernetes.io/last-applied-configuration") return [key, WITHHELD];
      return [key, withholdValue(inner)];
    }),
  );
}

// What the log records of an output: a Secret without its body, a kubeconfig without its credentials.
export function withhold(output: string): string {
  const text = output.trim();

  if (!text.startsWith("{") && !text.startsWith("[")) return output;
  try {
    return `${JSON.stringify(withholdValue(JSON.parse(text)))}\n`;
  } catch {
    return output;
  }
}

// What a failed command says of its reason, for the output of the run: the lines that name an error, without
// the traces, and without anything long enough to be a key, a token or a certificate.
export function failureSummary(output: string): string[] {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(error|fatal)\b|^\[error|\berror:|\bfailed\b|\bcannot\b|\bunable\b|timed out/i.test(line))
    .filter((line) => !/^(github\.com|k8s\.io|sigs\.k8s\.io|runtime|main)[./]/.test(line) && !/^I\d{4} /.test(line))
    .map((line) => line.replace(/[A-Za-z0-9+/=_-]{32,}/g, "withheld").slice(0, 300));
  const different = [...new Set(lines)];

  return different.length > 12 ? [...different.slice(0, 4), ...different.slice(-8)] : different;
}

// Every form a secret takes inside a base64 text, whose letters depend on where the secret starts.
function encodedForms(secret: string): string[] {
  return [0, 1, 2].map((shift) => {
    const encoded = Buffer.from(`${"-".repeat(shift)}${secret}`).toString("base64");

    return encoded.slice(shift ? 4 : 0, encoded.length - 4);
  });
}

// What the log of the operations must never hold: a generated secret, as it is or encoded, or a token of any origin.
export function assertLogWithholds(log: string, secrets: string[]): void {
  check(
    secrets.every((secret) => secret.length >= 16),
    "A generated secret is too short to be searched for",
  );
  check(!secrets.some((secret) => log.includes(secret)), "The log of the operations holds a generated secret");
  check(
    !secrets.some((secret) => encodedForms(secret).some((form) => log.includes(form))),
    "The log of the operations holds an encoded generated secret",
  );
  check(!TOKEN.test(log), "The log of the operations holds a token");
}

// Docker networks always, and the routes of the host where it can list them.
export function occupiedSubnets(
  networks: { Id: string; IPAM: { Config?: { Subnet?: string }[] | null } }[],
  routes: { dst?: string; dev?: string }[] | undefined,
  owned: { networkId: string; bridge: string },
): string[] {
  return [
    ...(routes ?? [])
      .filter((route) => !owned.networkId || route.dev !== owned.bridge)
      .map((route) => route.dst)
      .filter((value): value is string => !!value && value !== "default"),
    ...networks
      .filter((network) => network.Id !== owned.networkId)
      .flatMap((network) => (network.IPAM.Config ?? []).map((config) => config.Subnet))
      .filter((value): value is string => !!value && !value.includes(":")),
  ];
}
