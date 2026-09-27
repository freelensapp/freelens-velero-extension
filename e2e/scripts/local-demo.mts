import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, request } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { createTlsFixture } from "../../test/tls-fixture.ts";
import {
  compiledDiagnostics,
  DIRECT_PROOF_IMAGE,
  runDownloadProof,
  tlsProofResources,
} from "./local-download-proof.mts";
import {
  allowsFixtureArtifact,
  assertFixtureNamespaceContents,
  createStaticFixtures,
  FIXTURE_LABEL,
  fixtureArtifactPaths,
  fixtureDeletionRequest,
  fixtureNames,
  liveBackup,
  readFixture,
  restrictedFixtures,
  runLiveFixtures,
  verifyStaticFixtures,
} from "./local-fixtures.mts";
import {
  assertFailedNodeRemoval,
  assertLocalKind,
  assertOwnedNetwork,
  assertOwnedResource,
  assertStoppedKind,
  DEMO_BRIDGE,
  DEMO_CLUSTER,
  DEMO_CONTEXT,
  DEMO_NAMESPACE,
  DEMO_NETWORK,
  type DemoIdentity,
  type KindConfig,
  type KindNetwork,
  type KindNode,
  localEnvironment,
  OWNER_LABEL,
  requireCondition,
  SUBNETS,
  subnetsOverlap,
} from "./local-kind.mts";
import {
  BUCKET,
  type Credentials,
  DATA_DIRECTORY,
  IMAGES,
  KIND_HOSTS,
  type KubeResource,
  kindConfiguration,
  preloadedImage,
  prepareVeleroResources,
  STORAGE_ENDPOINT,
  storageManifests,
} from "./local-manifests.mts";
import { assertOfficialImages } from "./local-security.mts";

const STATE = join(homedir(), ".local", "state", DEMO_CLUSTER);
const CONFIG = join(STATE, "kubeconfig");
const JOURNAL = join(STATE, "ownership.json");
const LOG = join(STATE, "operations.log");
const KIND = join(STATE, "bin", "kind");
const environment = {
  ...localEnvironment(process.env, CONFIG),
  HOME: join(STATE, "home"),
  DOCKER_CONFIG: join(STATE, "docker"),
  XDG_CONFIG_HOME: join(STATE, "home", ".config"),
  XDG_CACHE_HOME: join(STATE, "cache"),
};

interface ResourceIdentity {
  apiVersion: string;
  kind: string;
  name: string;
  namespace?: string;
  uid?: string;
}

interface Journal {
  version: 1;
  owner: string;
  nodeId: string;
  networkId: string;
  kubeconfigHash: string;
  defaultKubeconfigHash: string;
  resources: ResourceIdentity[];
  phase: string;
  retiredNodeIds?: string[];
  bucket?: { name: string; created: boolean };
  temporaryChecks?: (ResourceIdentity & { owner: string })[];
  fixtureRun?: { id: string; started: string; phase: string };
}

let journal: Journal;
const executeFile = promisify(execFile);

function hash(file: string): string {
  return existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : "absent";
}

function save(): void {
  const temporary = `${JOURNAL}.next`;

  writeFileSync(temporary, JSON.stringify(journal, null, 2), { mode: 0o600 });
  renameSync(temporary, JOURNAL);
}

function command(executable: string, args: string[], input?: string, timeout = 120_000, recordOutput = true): string {
  try {
    const argumentsWithCache =
      executable === "kubectl" ? ["--cache-dir", join(STATE, "cache", "kubectl"), ...args] : args;
    const output = execFileSync(executable, argumentsWithCache, {
      env: environment,
      cwd: environment.HOME,
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
      maxBuffer: 32 * 1024 ** 2,
    });

    appendFileSync(LOG, `${executable} ${args.slice(0, 2).join(" ")}\n${recordOutput ? output : "output withheld"}\n`, {
      mode: 0o600,
    });
    return output;
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };

    appendFileSync(
      LOG,
      `${executable}: exit ${failure.status ?? "unknown"}\n${recordOutput ? `${failure.stdout ?? ""}\n${failure.stderr ?? ""}` : "diagnostic output withheld"}\n`,
      { mode: 0o600 },
    );
    throw new Error(`${executable} failed; details retained in the private operations log`);
  }
}

function docker(args: string[], input?: string, timeout?: number): string {
  return command("docker", args, input, timeout);
}

function nodes(): KindNode[] {
  const identifiers = docker(["ps", "-aq", "--filter", `label=io.x-k8s.kind.cluster=${DEMO_CLUSTER}`])
    .trim()
    .split("\n")
    .filter(Boolean);

  return identifiers.length ? JSON.parse(docker(["inspect", ...identifiers])) : [];
}

function verifyTarget(): void {
  requireCondition(
    journal?.owner && journal.nodeId && journal.networkId && journal.kubeconfigHash,
    "The private ownership journal is incomplete",
  );
  const network = JSON.parse(docker(["network", "inspect", DEMO_NETWORK]))[0] as KindNetwork;
  const config = JSON.parse(
    command("kubectl", ["--kubeconfig", CONFIG, "config", "view", "--raw", "-o", "json"]),
  ) as KindConfig;

  assertLocalKind(journal as DemoIdentity, nodes(), network, config, hash(CONFIG));
  requireCondition(
    hash(join(homedir(), ".kube", "config")) === journal.defaultKubeconfigHash,
    "The user's default kubeconfig changed; revalidation is required",
  );
}

function kubectl(args: string[], input?: string, timeout?: number, recordOutput = true): string {
  verifyTarget();
  return command(
    "kubectl",
    ["--kubeconfig", CONFIG, "--context", DEMO_CONTEXT, "--request-timeout=180s", ...args],
    input,
    timeout,
    recordOutput,
  );
}

function initialize(): number {
  process.umask(0o077);
  mkdirSync(STATE, { recursive: true, mode: 0o700 });
  requireCondition(
    !lstatSync(STATE).isSymbolicLink() && realpathSync(STATE) === resolve(STATE),
    "Private state must not be a symlink",
  );
  requireCondition(
    !realpathSync(STATE).startsWith(`${realpathSync(process.cwd())}/`),
    "Private state cannot be inside the project",
  );
  chmodSync(STATE, 0o700);
  for (const directory of [
    environment.HOME,
    environment.DOCKER_CONFIG,
    environment.XDG_CONFIG_HOME,
    environment.XDG_CACHE_HOME,
  ])
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(join(environment.DOCKER_CONFIG, "config.json"), "{}\n", { mode: 0o600 });
  const lock = openSync(join(STATE, "run.lock"), "wx", 0o600);

  try {
    if (existsSync(JOURNAL)) {
      journal = JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal;
      requireCondition(
        journal.version === 1 && /^[a-f0-9-]{36}$/.test(journal.owner) && Array.isArray(journal.resources),
        "Invalid ownership journal",
      );
    } else {
      requireCondition(
        !nodes().length && !docker(["network", "ls", "-q", "--filter", `name=^${DEMO_NETWORK}$`]).trim(),
        "Dedicated names are already in use",
      );
      journal = {
        version: 1,
        owner: randomUUID(),
        nodeId: "",
        networkId: "",
        kubeconfigHash: "",
        defaultKubeconfigHash: hash(join(homedir(), ".kube", "config")),
        resources: [],
        phase: "preflight",
      };
      save();
      const credentials = () => ({
        accessKey: randomBytes(16).toString("hex"),
        secretKey: randomBytes(32).toString("hex"),
      });

      writeFileSync(join(STATE, "credentials.json"), JSON.stringify({ admin: credentials(), velero: credentials() }), {
        mode: 0o600,
        flag: "wx",
      });
    }
  } catch (error) {
    closeSync(lock);
    unlinkSync(join(STATE, "run.lock"));
    throw error;
  }
  return lock;
}

function preflight(): void {
  assertOfficialImages(IMAGES);
  requireCondition(
    hash(join(homedir(), ".kube", "config")) === journal.defaultKubeconfigHash,
    "The default kubeconfig changed; review the private baseline before setup",
  );
  if (journal.networkId) {
    const [network] = JSON.parse(docker(["network", "inspect", DEMO_NETWORK])) as KindNetwork[];

    assertOwnedNetwork(journal, network);
  }
  const info = JSON.parse(docker(["info", "--format", "{{json .}}"])) as {
    OSType: string;
    Architecture: string;
    NCPU: number;
    MemTotal: number;
  };

  requireCondition(
    info.OSType === "linux" && info.Architecture === "x86_64" && info.NCPU >= 4 && info.MemTotal >= 8 * 1024 ** 3,
    "Insufficient local Docker capacity",
  );
  requireCondition(command(KIND, ["version"]).includes("v0.33.0"), "Expected private kind v0.33.0");
  const client = JSON.parse(command("kubectl", ["version", "--client", "-o", "json"])) as {
    clientVersion: { gitVersion: string };
  };

  requireCondition(client.clientVersion.gitVersion === "v1.33.4", "Expected kubectl v1.33.4");
  const routes = JSON.parse(command("ip", ["-j", "-4", "route", "show", "table", "all"])) as {
    dst?: string;
    dev?: string;
  }[];
  const identifiers = docker(["network", "ls", "-q"]).trim().split("\n").filter(Boolean);
  const networks = identifiers.length
    ? (JSON.parse(docker(["network", "inspect", ...identifiers])) as KindNetwork[])
    : [];
  const occupied = [
    ...routes
      .filter((route) => !journal.networkId || route.dev !== DEMO_BRIDGE)
      .map((route) => route.dst)
      .filter((value): value is string => !!value && value !== "default"),
    ...networks
      .filter((network) => network.Id !== journal.networkId)
      .flatMap((network) =>
        (network.IPAM.Config ?? []).map((config) => config.Subnet).filter((value) => value && !value.includes(":")),
      ),
  ];

  requireCondition(
    !Object.values(SUBNETS).some((subnet) => occupied.some((other) => subnetsOverlap(subnet, other))),
    "The dedicated subnet overlaps existing local networking",
  );
  for (const image of Object.values(IMAGES)) {
    const [inspected] = JSON.parse(docker(["image", "inspect", image])) as {
      Os: string;
      Architecture: string;
      RepoDigests: string[];
    }[];

    requireCondition(
      inspected.Os === "linux" &&
        inspected.Architecture === "amd64" &&
        inspected.RepoDigests.some((digest) => digest.endsWith(image.split("@")[1])),
      "A pinned local image is missing or mismatched",
    );
  }
}

function isolateNode(): void {
  verifyTarget();
  const [node] = JSON.parse(docker(["inspect", journal.nodeId])) as {
    NetworkSettings: { Networks: Record<string, { IPAddress: string }> };
  }[];
  const address = node.NetworkSettings.Networks[DEMO_NETWORK].IPAddress;

  requireCondition(/^198\.18\.64\.\d+$/.test(address), "Unexpected owned node address");
  docker(["exec", journal.nodeId, "ip", "route", "replace", SUBNETS.services, "dev", "eth0"]);
  for (const [parent, chain] of [
    ["OUTPUT", "FV_DEMO_OUT"],
    ["FORWARD", "FV_DEMO_FWD"],
  ]) {
    const rules = docker(["exec", journal.nodeId, "iptables", "-w", "-S"]);

    if (!rules.includes(`-N ${chain}\n`)) {
      docker(["exec", journal.nodeId, "iptables", "-w", "-N", chain]);
      docker([
        "exec",
        journal.nodeId,
        "iptables",
        "-w",
        "-A",
        chain,
        "-m",
        "conntrack",
        "--ctstate",
        "ESTABLISHED,RELATED",
        "-j",
        "RETURN",
      ]);
      for (const destination of ["127.0.0.0/8", `${address}/32`, SUBNETS.pods, SUBNETS.services])
        docker(["exec", journal.nodeId, "iptables", "-w", "-A", chain, "-d", destination, "-j", "RETURN"]);
      docker([
        "exec",
        journal.nodeId,
        "iptables",
        "-w",
        "-A",
        chain,
        "-j",
        "REJECT",
        "--reject-with",
        "icmp-net-unreachable",
      ]);
    }
    if (!rules.includes(`-A ${chain} -d ${SUBNETS.pods} -p tcp -m tcp --dport 18333 -j REJECT`)) {
      docker([
        "exec",
        journal.nodeId,
        "iptables",
        "-w",
        "-I",
        chain,
        "2",
        "-d",
        SUBNETS.pods,
        "-p",
        "tcp",
        "--dport",
        "18333",
        "-j",
        "REJECT",
      ]);
    }
    if (!rules.includes(`-A ${parent} -j ${chain}\n`))
      docker(["exec", journal.nodeId, "iptables", "-w", "-I", parent, "1", "-j", chain]);
  }
  for (const chain of ["OUTPUT", "FORWARD"]) {
    const rules = docker(["exec", journal.nodeId, "ip6tables", "-w", "-S", chain]);

    if (!rules.includes(`-A ${chain} ! -o lo -j REJECT`))
      docker(["exec", journal.nodeId, "ip6tables", "-w", "-I", chain, "1", "!", "-o", "lo", "-j", "REJECT"]);
  }
  docker(
    ["exec", "-i", journal.nodeId, "tee", "/etc/resolv.conf"],
    `nameserver ${address}\noptions attempts:1 timeout:1\n`,
  );
  const dns = JSON.parse(
    kubectl(["get", "configmap", "coredns", "--namespace", "kube-system", "-o", "json"]),
  ) as KubeResource & { data: { Corefile: string } };
  const original = join(STATE, "original-coredns.json");

  if (!existsSync(original)) {
    requireCondition(!dns.metadata.labels?.[OWNER_LABEL], "Unexpected CoreDNS ownership");
    writeFileSync(original, JSON.stringify(dns), { mode: 0o600, flag: "wx" });
  } else {
    requireCondition(
      dns.metadata.uid === (JSON.parse(readFileSync(original, "utf8")) as KubeResource).metadata.uid,
      "CoreDNS identity changed",
    );
  }
  dns.metadata.labels = { ...dns.metadata.labels, [OWNER_LABEL]: journal.owner };
  dns.data.Corefile =
    ".:53 {\n errors\n health\n ready\n kubernetes cluster.local in-addr.arpa ip6.arpa {\n  pods insecure\n  ttl 30\n }\n cache 30\n loop\n reload\n loadbalance\n}\n";
  kubectl(["replace", "-f", "-"], JSON.stringify(dns));
  docker(["exec", journal.nodeId, "mkdir", "-p", DATA_DIRECTORY]);
  docker(["exec", journal.nodeId, "chown", "1000:1000", DATA_DIRECTORY]);
  journal.phase = "isolated";
  save();
}

function verifyPreloadedImages(): void {
  verifyTarget();
  assertOfficialImages(IMAGES);
  const imported = JSON.parse(docker(["exec", journal.nodeId, "crictl", "images", "-o", "json"])) as {
    images: { id: string; repoTags?: string[] }[];
  };

  for (const reference of [IMAGES.velero, IMAGES.plugin, IMAGES.storage]) {
    const [expected] = JSON.parse(docker(["image", "inspect", reference])) as { Id: string }[];
    const image = imported.images.find((item) => item.repoTags?.includes(preloadedImage(reference)));

    requireCondition(image?.id === expected.Id, "Preloaded content does not match the official digest-pinned image");
  }
}

function setupCluster(): void {
  preflight();
  if (!journal.networkId) {
    requireCondition(
      !docker(["network", "ls", "-q", "--filter", `name=^${DEMO_NETWORK}$`]).trim(),
      "Network name collision",
    );
    journal.networkId = docker([
      "network",
      "create",
      "--internal",
      "--driver",
      "bridge",
      "--subnet",
      SUBNETS.docker,
      "--gateway",
      "198.18.64.1",
      "--opt",
      `com.docker.network.bridge.name=${DEMO_BRIDGE}`,
      "--label",
      `${OWNER_LABEL}=${journal.owner}`,
      DEMO_NETWORK,
    ]).trim();
    save();
  }
  if (!journal.nodeId) {
    requireCondition(!nodes().length, "Kind node name collision");
    const config = join(STATE, "kind.json");
    const hosts = join(STATE, "kind-hosts");

    writeFileSync(hosts, KIND_HOSTS, { mode: 0o600 });
    const configuration = kindConfiguration(hosts);
    writeFileSync(config, JSON.stringify(configuration), { mode: 0o600 });
    let bootstrapError: unknown;

    try {
      command(
        KIND,
        [
          "create",
          "cluster",
          "--name",
          DEMO_CLUSTER,
          "--image",
          IMAGES.node,
          "--config",
          config,
          "--kubeconfig",
          CONFIG,
          "--retain",
          "--wait",
          "180s",
        ],
        undefined,
        360_000,
      );
    } catch (error) {
      bootstrapError = error;
    } finally {
      const created = nodes();

      if (created.length === 1 && created[0].NetworkSettings.Networks[DEMO_NETWORK]?.NetworkID === journal.networkId) {
        journal.nodeId = created[0].Id;
        docker(["update", "--restart=no", journal.nodeId]);
        if (existsSync(CONFIG)) {
          chmodSync(CONFIG, 0o600);
          journal.kubeconfigHash = hash(CONFIG);
        }
        save();
      }
    }
    if (bootstrapError && !journal.nodeId) throw bootstrapError;
  }
  if (!journal.kubeconfigHash) {
    const [network] = JSON.parse(docker(["network", "inspect", DEMO_NETWORK])) as KindNetwork[];
    const current = nodes();

    assertOwnedNetwork(journal, network);
    requireCondition(
      current.length === 1 &&
        current[0].Id === journal.nodeId &&
        current[0].State.Running &&
        current[0].NetworkSettings.Networks[DEMO_NETWORK]?.NetworkID === journal.networkId,
      "Cannot export credentials from an unverified bootstrap node",
    );
    const generated = command(KIND, ["get", "kubeconfig", "--name", DEMO_CLUSTER, "--internal"]);

    writeFileSync(CONFIG, generated, { mode: 0o600, flag: "wx" });
    journal.kubeconfigHash = hash(CONFIG);
    save();
  }
  if (journal.phase === "preflight") {
    requireCondition(hash(CONFIG) === journal.kubeconfigHash, "Generated kubeconfig was changed before initialization");
    const [network] = JSON.parse(docker(["network", "inspect", DEMO_NETWORK])) as KindNetwork[];
    const current = nodes();
    const config = JSON.parse(
      command("kubectl", ["--kubeconfig", CONFIG, "config", "view", "--raw", "-o", "json"]),
    ) as KindConfig;

    if (config.clusters?.[0]?.cluster.server === `https://${DEMO_CLUSTER}-control-plane:6443`) {
      config.clusters[0].cluster.server = `https://${current[0]?.NetworkSettings.Networks[DEMO_NETWORK]?.IPAddress}:6443`;
      assertLocalKind(journal, current, network, config, journal.kubeconfigHash);
      writeFileSync(CONFIG, JSON.stringify(config), { mode: 0o600 });
      journal.kubeconfigHash = hash(CONFIG);
      save();
    }
  }
  verifyTarget();
  docker(["update", "--restart=no", "--cpus=4", "--memory=8g", "--memory-swap=8g", journal.nodeId]);
  isolateNode();
  for (const reference of [IMAGES.velero, IMAGES.plugin, IMAGES.storage]) {
    const tag = preloadedImage(reference);
    const [expected] = JSON.parse(docker(["image", "inspect", reference])) as { Id: string }[];
    const existing = docker(["image", "ls", "-q", "--filter", `reference=${tag}`]).trim();

    if (existing) {
      const [tagged] = JSON.parse(docker(["image", "inspect", tag])) as { Id: string }[];

      requireCondition(
        tagged.Id === expected.Id,
        "Official local tag differs from the selected digest; refusing overwrite",
      );
    } else {
      docker(["tag", reference, tag]);
    }
  }
  command(
    KIND,
    [
      "load",
      "docker-image",
      "--name",
      DEMO_CLUSTER,
      ...[IMAGES.velero, IMAGES.plugin, IMAGES.storage].map(preloadedImage),
    ],
    undefined,
    600_000,
  );
  verifyPreloadedImages();
  kubectl(["wait", "--for=condition=Ready", "node", "--all", "--timeout=120s"], undefined, 150_000);
  journal.phase = "cluster-ready";
  save();
  console.log(
    "PASS: dedicated local kind is ready on its verified local endpoint, isolated, resource-limited and loaded with pinned images.",
  );
}

function resourceArguments(resource: ResourceIdentity): string[] {
  const group = resource.apiVersion.includes("/") ? `.${resource.apiVersion.split("/")[0]}` : "";

  return [
    `${resource.kind}${group}`,
    resource.name,
    ...(resource.namespace ? ["--namespace", resource.namespace] : []),
  ];
}

function applyOwned(resource: KubeResource): void {
  const identity: ResourceIdentity = {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    name: resource.metadata.name,
    namespace: resource.metadata.namespace,
  };
  let entry = journal.resources.find(
    (item) =>
      item.apiVersion === identity.apiVersion &&
      item.kind === identity.kind &&
      item.name === identity.name &&
      item.namespace === identity.namespace,
  );
  const raw = kubectl(["get", ...resourceArguments(identity), "--ignore-not-found", "-o", "json"]);

  requireCondition(resource.metadata.labels?.[OWNER_LABEL] === journal.owner, "Manifest ownership is missing");
  if (raw.trim()) {
    requireCondition(entry, "Refusing an existing resource not recorded by this setup");
    assertOwnedResource(journal.owner, JSON.parse(raw), entry.uid);
  } else {
    requireCondition(!entry?.uid, "An owned resource disappeared; refusing silent replacement");
  }
  if (!entry) {
    entry = identity;
    journal.resources.push(entry);
    save();
  }
  const manifest = structuredClone(resource);

  if (raw.trim()) manifest.metadata.uid = (JSON.parse(raw) as KubeResource).metadata.uid;
  const action = raw.trim() ? ["apply", "--server-side", "--field-manager=freelens-velero-demo"] : ["create"];
  const created = JSON.parse(kubectl([...action, "-f", "-", "-o", "json"], JSON.stringify(manifest))) as KubeResource;

  assertOwnedResource(journal.owner, created, entry.uid);
  entry.uid = created.metadata.uid;
  save();
}

function storageRequest(
  method: "GET" | "PUT" | "HEAD",
  path: string,
  credentials?: Credentials,
): { code: number; body: string; bytes: Buffer; headers: Record<string, string[]> } {
  requireCondition(
    path === `/${BUCKET}` ||
      path === "/velero-denied" ||
      (journal.fixtureRun && allowsFixtureArtifact(method, path, journal.fixtureRun.id)),
    "Unexpected local bucket target",
  );
  const service = JSON.parse(
    kubectl(["get", "service", "seaweedfs", "--namespace", DEMO_NAMESPACE, "-o", "json"]),
  ) as KubeResource & { spec: { clusterIP: string } };

  assertOwnedResource(
    journal.owner,
    service,
    journal.resources.find((item) => item.kind === "Service" && item.name === "seaweedfs")?.uid,
  );
  requireCondition(
    subnetsOverlap(SUBNETS.services, service.spec.clusterIP),
    "Storage service is outside the dedicated service subnet",
  );
  const endpoint = new URL(STORAGE_ENDPOINT);
  const settings = [
    "silent",
    "show-error",
    "connect-timeout = 3",
    "max-time = 10",
    'proto = "=http"',
    `url = ${JSON.stringify(`${STORAGE_ENDPOINT}${path}`)}`,
    `resolve = ${JSON.stringify(`${endpoint.hostname}:${endpoint.port}:${service.spec.clusterIP}`)}`,
    ...(method === "HEAD" ? [] : ["max-filesize = 16777216"]),
    `write-out = ${JSON.stringify('\nFV_HTTP_META:{"code":%{response_code},"headers":%{header_json}}')}`,
    method === "HEAD" ? "head" : `request = ${JSON.stringify(method)}`,
  ];

  if (credentials)
    settings.push(
      'aws-sigv4 = "aws:amz:us-east-1:s3"',
      `user = ${JSON.stringify(`${credentials.accessKey}:${credentials.secretKey}`)}`,
    );
  let output: Buffer;

  try {
    output = execFileSync("docker", ["exec", "-i", journal.nodeId, "curl", "--config", "-"], {
      env: environment,
      cwd: environment.HOME,
      input: `${settings.join("\n")}\n`,
      timeout: 15_000,
      maxBuffer: 17 * 1024 ** 2,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    appendFileSync(LOG, `Local storage request failed\n${String((error as { stderr?: Buffer }).stderr ?? "")}\n`, {
      mode: 0o600,
    });
    throw new Error("Local storage request failed; details retained in the private operations log");
  }
  const marker = "\nFV_HTTP_META:";
  const separator = output.lastIndexOf(marker);

  requireCondition(separator >= 0, "Missing local storage response metadata");
  const metadata = JSON.parse(output.subarray(separator + marker.length).toString("utf8")) as {
    code: number;
    headers: Record<string, string[]>;
  };

  requireCondition(
    Number.isInteger(metadata.code) && metadata.code >= 100 && metadata.code <= 599,
    "Invalid local storage response",
  );
  const bytes = output.subarray(0, separator);

  return { code: metadata.code, headers: metadata.headers, bytes, body: bytes.toString("utf8") };
}

function prepareBucket(): void {
  verifyPreloadedImages();
  const credentials = JSON.parse(readFileSync(join(STATE, "credentials.json"), "utf8")) as {
    admin: Credentials;
    velero: Credentials;
  };
  const existing = storageRequest("HEAD", `/${BUCKET}`, credentials.admin);

  requireCondition(existing.code === 200 || existing.code === 404, "Unexpected bucket bootstrap response");
  if (existing.code === 200) {
    requireCondition(journal.bucket?.name === BUCKET, "Refusing an unowned existing storage bucket");
  } else {
    requireCondition(!journal.bucket?.created, "Owned bucket disappeared; refusing silent recreation");
    journal.bucket = { name: BUCKET, created: false };
    save();
    requireCondition(
      storageRequest("PUT", `/${BUCKET}`, credentials.admin).code === 200,
      "Local bucket creation failed",
    );
  }
  journal.bucket = { name: BUCKET, created: true };
  save();
  requireCondition(
    storageRequest("GET", `/${BUCKET}`, credentials.velero).code === 200,
    "Velero identity cannot list its local bucket",
  );
  requireCondition(storageRequest("GET", `/${BUCKET}`).code === 403, "Anonymous storage access was not denied");
  requireCondition(
    storageRequest("GET", `/${BUCKET}`, { ...credentials.velero, secretKey: "invalid-synthetic-secret" }).code === 403,
    "Incorrect storage credentials were not denied",
  );
  requireCondition(
    storageRequest("GET", "/velero-denied", credentials.velero).code === 403,
    "Velero identity is not restricted to its owned bucket",
  );
  journal.phase = "bucket-ready";
  save();
  console.log(
    "PASS: owned bucket ready; signed access works and anonymous, wrong-secret and out-of-scope bucket access are denied.",
  );
}

function installStorage(): void {
  verifyPreloadedImages();
  const credentials = JSON.parse(readFileSync(join(STATE, "credentials.json"), "utf8")) as {
    admin: Credentials;
    velero: Credentials;
  };

  for (const resource of storageManifests(journal.owner, credentials.admin, credentials.velero)) applyOwned(resource);
  kubectl(
    ["rollout", "status", "deployment/seaweedfs", "--namespace", DEMO_NAMESPACE, "--timeout=180s"],
    undefined,
    210_000,
  );
  journal.phase = "storage-ready";
  save();
  console.log(
    "PASS: owned storage resources installed and Deployment ready; authenticated bucket qualification is still pending.",
  );
}

function installVelero(): void {
  verifyPreloadedImages();
  requireCondition(
    journal.bucket?.name === BUCKET && journal.bucket.created,
    "The owned local bucket must be ready first",
  );
  const credentials = JSON.parse(readFileSync(join(STATE, "credentials.json"), "utf8")) as { velero: Credentials };
  const credentialFile = join(STATE, "velero-credentials");

  requireCondition(
    /^[a-f0-9]+$/.test(credentials.velero.accessKey) && /^[a-f0-9]+$/.test(credentials.velero.secretKey),
    "Invalid generated local credential format",
  );
  writeFileSync(
    credentialFile,
    `[default]\naws_access_key_id=${credentials.velero.accessKey}\naws_secret_access_key=${credentials.velero.secretKey}\n`,
    { mode: 0o600 },
  );
  const user = process.getuid?.();
  const group = process.getgid?.();

  requireCondition(typeof user === "number" && typeof group === "number", "Local Unix identity is required");
  const generated = JSON.parse(
    docker([
      "run",
      "--rm",
      "--pull=never",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      `--user=${user}:${group}`,
      "--mount",
      `type=bind,src=${credentialFile},dst=/local-credentials,readonly`,
      "--mount",
      `type=bind,src=${CONFIG},dst=/local-kubeconfig,readonly`,
      "--entrypoint=/velero",
      IMAGES.velero,
      "install",
      "--dry-run",
      "--output=json",
      "--kubeconfig=/local-kubeconfig",
      `--kubecontext=${DEMO_CONTEXT}`,
      `--namespace=${DEMO_NAMESPACE}`,
      "--provider=aws",
      `--bucket=${BUCKET}`,
      "--secret-file=/local-credentials",
      `--image=${preloadedImage(IMAGES.velero)}`,
      `--plugins=${preloadedImage(IMAGES.plugin)}`,
      "--use-volume-snapshots=false",
      "--use-node-agent",
      `--backup-location-config=region=us-east-1,s3ForcePathStyle=true,s3Url=${STORAGE_ENDPOINT}`,
    ]),
  ) as { items: KubeResource[] };
  const resources = prepareVeleroResources(journal.owner, generated);
  const definitions = resources.filter((resource) => resource.kind === "CustomResourceDefinition");

  requireCondition(definitions.length === 13, "Expected the 13 reviewed Velero CRDs");
  for (const definition of definitions) applyOwned(definition);
  kubectl(
    [
      "wait",
      "--for=condition=Established",
      "customresourcedefinitions",
      "--selector",
      `${OWNER_LABEL}=${journal.owner}`,
      "--timeout=60s",
    ],
    undefined,
    90_000,
  );
  for (const resource of resources.filter((item) => item.kind !== "CustomResourceDefinition")) applyOwned(resource);
  kubectl(
    ["rollout", "status", "deployment/velero", "--namespace", DEMO_NAMESPACE, "--timeout=180s"],
    undefined,
    210_000,
  );
  kubectl(
    ["rollout", "status", "daemonset/node-agent", "--namespace", DEMO_NAMESPACE, "--timeout=180s"],
    undefined,
    210_000,
  );
  kubectl(
    [
      "wait",
      "--for=jsonpath={.status.phase}=Available",
      "backupstoragelocation/default",
      "--namespace",
      DEMO_NAMESPACE,
      "--timeout=180s",
    ],
    undefined,
    210_000,
  );
  journal.phase = "velero-ready";
  save();
  console.log(
    "PASS: official Velero server, node-agent and 13 CRDs installed; the local BackupStorageLocation is Available. No backup or restore was created.",
  );
}

function deleteCheck(entry: ResourceIdentity, owner: string): void {
  requireCondition(
    entry.kind === "ConfigMap" && entry.namespace === DEMO_NAMESPACE && entry.uid,
    "Only a recorded temporary ConfigMap can be cleaned",
  );
  const current = JSON.parse(kubectl(["get", ...resourceArguments(entry), "-o", "json"])) as KubeResource;

  assertOwnedResource(owner, current, entry.uid);
  kubectl(
    ["delete", "--raw", `/api/v1/namespaces/${DEMO_NAMESPACE}/configmaps/${entry.name}`, "-f", "-"],
    JSON.stringify({ apiVersion: "v1", kind: "DeleteOptions", preconditions: { uid: entry.uid } }),
  );
  requireCondition(
    !kubectl(["get", ...resourceArguments(entry), "--ignore-not-found", "-o", "json"]).trim(),
    "Temporary check cleanup is incomplete",
  );
}

function verifyOwnershipCleanup(): void {
  requireCondition(!journal.temporaryChecks?.length, "An earlier temporary check needs owned cleanup before rerunning");
  const suffix = randomUUID().slice(0, 8);
  const sentinelOwner = `sentinel-${suffix}`;
  const sentinel: KubeResource = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: `velero-sentinel-${suffix}`,
      namespace: DEMO_NAMESPACE,
      labels: { [OWNER_LABEL]: sentinelOwner },
    },
    data: { value: "unchanged-synthetic-sentinel" },
  };
  const tracked: ResourceIdentity & { owner: string } = {
    apiVersion: "v1",
    kind: "ConfigMap",
    name: sentinel.metadata.name,
    namespace: DEMO_NAMESPACE,
    owner: sentinelOwner,
  };
  const temporary: KubeResource = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: `velero-check-${suffix}`, namespace: DEMO_NAMESPACE, labels: { [OWNER_LABEL]: journal.owner } },
    data: { value: "temporary" },
  };
  const simulatedFailure = new Error("Synthetic check interruption");

  journal.temporaryChecks = [tracked];
  save();
  try {
    const created = JSON.parse(kubectl(["create", "-f", "-", "-o", "json"], JSON.stringify(sentinel))) as KubeResource;

    assertOwnedResource(sentinelOwner, created);
    tracked.uid = created.metadata.uid;
    save();
    const collision = structuredClone(sentinel);

    collision.metadata.labels = { [OWNER_LABEL]: journal.owner };
    let refused = false;

    try {
      applyOwned(collision);
    } catch (error) {
      refused = error instanceof Error && error.message === "Refusing an existing resource not recorded by this setup";
    }
    requireCondition(refused, "An existing sentinel was not protected from overwrite");
    applyOwned(temporary);
    applyOwned(temporary);
    throw simulatedFailure;
  } catch (error) {
    if (error !== simulatedFailure) throw error;
  } finally {
    const entry = journal.resources.find(
      (item) => item.kind === "ConfigMap" && item.name === temporary.metadata.name && item.namespace === DEMO_NAMESPACE,
    );

    if (entry?.uid) {
      deleteCheck(entry, journal.owner);
      journal.resources = journal.resources.filter((item) => item !== entry);
      save();
    }
    if (tracked.uid) {
      const preserved = JSON.parse(kubectl(["get", ...resourceArguments(tracked), "-o", "json"])) as KubeResource & {
        data: { value: string };
      };

      assertOwnedResource(sentinelOwner, preserved, tracked.uid);
      requireCondition(
        preserved.data.value === "unchanged-synthetic-sentinel",
        "Sentinel data was modified by cleanup",
      );
      deleteCheck(tracked, sentinelOwner);
      journal.temporaryChecks = [];
      save();
    }
  }
  console.log(
    "PASS: pre-existing collision refused, owned reapply kept identity, simulated failure cleaned its fixture and preserved the sentinel; all temporary ConfigMaps removed.",
  );
}

async function verifyEnvironment(): Promise<void> {
  verifyPreloadedImages();
  prepareBucket();
  for (const entry of journal.resources) {
    const resource = JSON.parse(kubectl(["get", ...resourceArguments(entry), "-o", "json"])) as KubeResource;

    assertOwnedResource(journal.owner, resource, entry.uid);
  }
  for (const workload of ["deployment/seaweedfs", "deployment/velero", "daemonset/node-agent"]) {
    kubectl(["rollout", "status", workload, "--namespace", DEMO_NAMESPACE, "--timeout=60s"], undefined, 90_000);
  }
  const location = JSON.parse(
    kubectl(["get", "backupstoragelocation/default", "--namespace", DEMO_NAMESPACE, "-o", "json"]),
  ) as { status?: { phase?: string } };

  requireCondition(location.status?.phase === "Available", "The local BackupStorageLocation is not Available");
  const operations = JSON.parse(
    kubectl([
      "get",
      "backups.velero.io,restores.velero.io,schedules.velero.io,downloadrequests.velero.io,serverstatusrequests.velero.io",
      "--namespace",
      DEMO_NAMESPACE,
      "-o",
      "json",
    ]),
  ) as { items: unknown[] };

  requireCondition(operations.items.length === 0, "T0.4 readiness requires a fixture-free installation");
  const pods = JSON.parse(
    kubectl([
      "get",
      "pods",
      "--namespace",
      DEMO_NAMESPACE,
      "--selector",
      `app.kubernetes.io/name=velero-demo-storage,${OWNER_LABEL}=${journal.owner}`,
      "-o",
      "json",
    ]),
  ) as {
    items: (KubeResource & {
      status: { podIP: string; containerStatuses: { name: string; ready: boolean; containerID: string }[] };
    })[];
  };

  requireCondition(pods.items.length === 1, "Expected one owned storage pod");
  const pod = pods.items[0];
  const container = pod.status.containerStatuses.find((item) => item.name === "seaweedfs" && item.ready);

  assertOwnedResource(journal.owner, pod);
  requireCondition(container, "Storage container identity is unavailable");
  requireCondition(container.containerID?.startsWith("containerd://"), "Storage container identity is unavailable");
  const inspected = JSON.parse(
    docker(["exec", journal.nodeId, "crictl", "inspect", container.containerID.slice("containerd://".length)]),
  ) as { info: { pid: number } };

  requireCondition(Number.isInteger(inspected.info.pid) && inspected.info.pid > 1, "Invalid owned container process");
  const podNetwork = ["nsenter", "--target", String(inspected.info.pid), "--net", "--"];
  const sockets = docker([
    "exec",
    journal.nodeId,
    ...podNetwork,
    "ss",
    "--no-header",
    "--listening",
    "--tcp",
    "--numeric",
  ]);
  const exposed = sockets
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[3])
    .filter((address) => address && !address.startsWith("127.0.0.1:") && !address.startsWith("[::1]:"));

  requireCondition(
    exposed.some((address) => address.endsWith(":8333")) &&
      exposed.every((address) => address.endsWith(":8333") || address.endsWith(":18333")),
    "An unexpected storage listener exists",
  );
  requireCondition(subnetsOverlap(SUBNETS.pods, pod.status.podIP), "Storage pod is outside the owned pod network");
  const rejectedPackets = (chain: string) => {
    const rules = docker(["exec", journal.nodeId, "iptables", "-w", "-n", "-v", "-x", "-L", chain]);
    const rejected = rules
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((fields) => fields[2] === "REJECT");

    requireCondition(
      rejected.length > 0 && rejected.every((fields) => /^\d+$/.test(fields[0])),
      "Required local rejection rule is missing",
    );
    return rejected.reduce((total, fields) => total + BigInt(fields[0]), 0n);
  };
  const rejectedBefore = rejectedPackets("FV_DEMO_OUT");
  let internalPortDenied = false;

  try {
    await executeFile(
      "docker",
      [
        "exec",
        journal.nodeId,
        "curl",
        "--silent",
        "--show-error",
        "--connect-timeout",
        "2",
        "--max-time",
        "3",
        `http://${pod.status.podIP}:18333/`,
      ],
      { env: environment, timeout: 5000 },
    );
  } catch (error) {
    internalPortDenied = (error as { code?: number }).code === 7;
  }
  requireCondition(
    internalPortDenied && rejectedPackets("FV_DEMO_OUT") > rejectedBefore,
    "Storage gRPC is reachable outside its pod",
  );
  console.log(
    "PASS: workloads ready, S3 accessible, storage control ports isolated; no backup, restore or diagnostic request exists.",
  );
  let requests = 0;
  const server = createServer((_incoming, response) => {
    requests += 1;
    response.end("synthetic-local-listener");
  });

  server.listen(0, "198.18.64.1");
  await once(server, "listening");
  try {
    const address = server.address();

    requireCondition(address && typeof address !== "string", "Local listener address is unavailable");
    const url = `http://198.18.64.1:${address.port}/`;

    await new Promise<void>((resolveRequest, rejectRequest) => {
      const outgoing = request(url, { agent: false, timeout: 3000 }, (response) => {
        response.resume();
        response.once("end", () =>
          response.statusCode === 200
            ? resolveRequest()
            : rejectRequest(new Error("Local listener positive control failed")),
        );
      });

      outgoing.once("error", rejectRequest);
      outgoing.once("timeout", () => outgoing.destroy(new Error("Local listener timed out")));
      outgoing.end();
    });
    requireCondition(requests === 1, "Synthetic local listener did not receive its positive control");
    for (const [name, prefix, chain] of [
      ["node", [] as string[], "FV_DEMO_OUT"],
      ["storage-pod", podNetwork, "FV_DEMO_FWD"],
    ] as const) {
      verifyTarget();
      const before = rejectedPackets(chain);
      let refused = false;

      try {
        await executeFile(
          "docker",
          [
            "exec",
            journal.nodeId,
            ...prefix,
            "curl",
            "--silent",
            "--show-error",
            "--connect-timeout",
            "2",
            "--max-time",
            "3",
            "--output",
            "/dev/null",
            url,
          ],
          { env: environment, timeout: 5000 },
        );
      } catch (error) {
        refused = (error as { code?: number }).code === 7;
      }
      requireCondition(
        refused && requests === 1 && rejectedPackets(chain) > before,
        `Egress isolation failed for ${name}`,
      );
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose, rejectClose) =>
      server.close((error) => (error ? rejectClose(error) : resolveClose())),
    );
  }
  verifyOwnershipCleanup();
  verifyTarget();
  journal.phase = "verified";
  save();
  writeFileSync(
    join(STATE, "readiness.json"),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        context: DEMO_CONTEXT,
        images: IMAGES,
        resources: journal.resources.length,
        storageAuth: "pass",
        readiness: "pass",
        egress: "pass",
        controlPorts: "pass",
        ownershipCleanup: "pass",
        operations: 0,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "PASS: node and storage-pod egress rejected at the firewall; positive local control passed, listener removed, default kubeconfig unchanged.",
  );
}

function removeFailedNode(): void {
  const network = JSON.parse(docker(["network", "inspect", DEMO_NETWORK]))[0] as KindNetwork;

  assertFailedNodeRemoval(journal, nodes(), network, journal.resources.length, existsSync(CONFIG));
  requireCondition(
    hash(join(homedir(), ".kube", "config")) === journal.defaultKubeconfigHash,
    "The default kubeconfig changed",
  );
  const removedId = journal.nodeId;

  journal.phase = "removing-failed-node";
  save();
  docker(["rm", "--volumes", removedId]);
  requireCondition(nodes().length === 0, "Failed-node removal did not complete");
  journal.retiredNodeIds = [...(journal.retiredNodeIds ?? []), removedId];
  journal.nodeId = "";
  journal.kubeconfigHash = "";
  journal.phase = "preflight";
  save();
  console.log(
    "PASS: removed only the authorized stopped bootstrap node; owned network, journal and credentials retained.",
  );
}

function prepareFixtures(): void {
  verifyPreloadedImages();
  if (!journal.fixtureRun) {
    journal.fixtureRun = { id: randomBytes(4).toString("hex"), started: new Date().toISOString(), phase: "preparing" };
    save();
  }
  requireCondition(
    journal.fixtureRun.phase === "preparing",
    "Fixture run already prepared; do not replace its evidence",
  );
  const snapshots = createStaticFixtures({ owner: journal.owner, kubectl, apply: applyOwned }, journal.fixtureRun.id);

  writeFileSync(join(STATE, "fixture-static-snapshots.json"), JSON.stringify(snapshots), { mode: 0o600 });
  journal.fixtureRun.phase = "static-ready";
  save();
  console.log(
    `PASS: ${snapshots.length} labelled synthetic objects accepted with exact status readback; controller-isolation evidence will be checked after live operations.`,
  );
}

async function executeLiveFixtures(): Promise<void> {
  verifyPreloadedImages();
  requireCondition(
    journal.fixtureRun?.phase === "static-ready",
    "Static fixtures must be prepared before live verification",
  );
  const runtime = { owner: journal.owner, kubectl, apply: applyOwned };
  const result = await runLiveFixtures(runtime, journal.fixtureRun.id);
  const snapshots = JSON.parse(readFileSync(join(STATE, "fixture-static-snapshots.json"), "utf8")) as KubeResource[];

  verifyStaticFixtures(runtime, snapshots);
  writeFileSync(join(STATE, "fixture-live-result.json"), JSON.stringify({ run: journal.fixtureRun.id, ...result }), {
    mode: 0o600,
  });
  journal.fixtureRun.phase = "live-verified";
  save();
  console.log(
    `PASS: live Backup and Restore Completed; ${result.configMaps} ConfigMaps and ${result.payloadBytes} payload bytes match, and ${snapshots.length} synthetic object versions/statuses are unchanged.`,
  );
}

function verifyFixtureArtifacts(): void {
  verifyPreloadedImages();
  requireCondition(
    journal.fixtureRun &&
      ["live-verified", "artifacts-verified", "permissions-verified"].includes(journal.fixtureRun.phase),
    "Live fixture recovery must pass before artifact verification",
  );
  const paths = fixtureArtifactPaths(journal.fixtureRun.id);
  const credentials = JSON.parse(readFileSync(join(STATE, "credentials.json"), "utf8")) as { velero: Credentials };
  const archive = storageRequest("HEAD", paths.archive, credentials.velero);
  const size = Number(archive.headers["content-length"]?.[0]);
  const etag = archive.headers.etag?.[0] ?? "";
  const parts = Number(/-(\d+)"?$/.exec(etag)?.[1]);

  requireCondition(
    archive.code === 200 && size > 8 * 1024 ** 2 && parts >= 2,
    "The stored backup does not prove the expected multipart upload",
  );
  const directory = join(STATE, "fixture-artifacts", journal.fixtureRun.id);

  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const [name, path] of Object.entries(paths).filter(([name]) => name !== "archive")) {
    const response = storageRequest("GET", path, credentials.velero);

    requireCondition(response.code === 200, `Expected fixture artifact is unavailable: ${name}`);
    const content = gunzipSync(response.bytes, { maxOutputLength: 4 * 1024 ** 2 });

    requireCondition(content.length > 0, "Fixture artifact is unexpectedly empty");
    if (name.endsWith("Results")) JSON.parse(content.toString("utf8"));
    writeFileSync(join(directory, `${name}.txt`), content, { mode: 0o600 });
  }
  if (journal.fixtureRun.phase === "live-verified") journal.fixtureRun.phase = "artifacts-verified";
  save();
  writeFileSync(
    join(STATE, "fixture-artifact-result.json"),
    JSON.stringify({
      run: journal.fixtureRun.id,
      storedBytes: size,
      multipartParts: parts,
      artifacts: 4,
      archiveDownloaded: false,
    }),
    { mode: 0o600 },
  );
  console.log(
    `PASS: multipart backup metadata verified (${size} stored bytes); four gzip log/result artifacts retrieved. No backup archive or signed URL was downloaded.`,
  );
}

function verifyFixturePermissions(): void {
  verifyPreloadedImages();
  requireCondition(
    journal.fixtureRun?.phase === "artifacts-verified",
    "Fixture artifacts must be verified before permission cases",
  );
  const run = journal.fixtureRun.id;
  const names = fixtureNames(run);
  const runtime = { owner: journal.owner, kubectl, apply: applyOwned };
  const resources = restrictedFixtures(journal.owner, run);

  for (const resource of resources) applyOwned(resource);
  const missingLocation = readFixture(runtime, resources[0]);
  const readerFile = join(STATE, `fixture-reader-${run}.json`);
  const token = kubectl(["create", "token", "fixture-reader", "--namespace", names.static, "--duration=10m"]).trim();

  requireCondition(token.length > 100, "Local reader credential was not generated");
  const config = JSON.parse(readFileSync(CONFIG, "utf8")) as KindConfig;

  config.users[0].user = { token };
  writeFileSync(readerFile, JSON.stringify(config), { mode: 0o600 });
  const asReader = (args: string[], input?: string) => {
    verifyTarget();
    return spawnSync(
      "kubectl",
      [
        "--cache-dir",
        join(STATE, "cache", "fixture-reader"),
        "--kubeconfig",
        readerFile,
        "--context",
        DEMO_CONTEXT,
        "--request-timeout=10s",
        ...args,
      ],
      { env: environment, cwd: environment.HOME, input, encoding: "utf8", timeout: 15_000, maxBuffer: 4 * 1024 ** 2 },
    );
  };
  let denied = 0;

  try {
    const allowed = asReader(["get", "--raw", `/apis/velero.io/v1/namespaces/${names.static}/backups`]);

    requireCondition(
      allowed.status === 0 && JSON.parse(allowed.stdout).items.length === 14,
      "Namespace-limited fixture reader cannot list its backups",
    );
    for (const path of [
      "/apis/velero.io/v1/backups",
      "/apis/apiextensions.k8s.io/v1/customresourcedefinitions",
      `/api/v1/namespaces/${DEMO_NAMESPACE}/secrets/cloud-credentials`,
      `/api/v1/namespaces/${names.static}/secrets/fixture-certificate`,
      `/apis/velero.io/v1/namespaces/${names.static}/volumesnapshotlocations`,
    ]) {
      const response = asReader(["get", "--raw", path]);

      requireCondition(
        response.status === 1 && response.stderr.toLowerCase().includes("forbidden"),
        "A restricted fixture read was not denied by RBAC",
      );
      denied += 1;
    }
    const attempted = liveBackup(journal.owner, run);

    attempted.metadata = { ...attempted.metadata, name: `denied-backup-${run}`, namespace: names.static };
    const creation = asReader(
      ["create", "--raw", `/apis/velero.io/v1/namespaces/${names.static}/backups`, "-f", "-"],
      JSON.stringify(attempted),
    );

    requireCondition(
      creation.status === 1 && creation.stderr.toLowerCase().includes("forbidden"),
      "The restricted identity was allowed to create a Backup",
    );
    denied += 1;
    const diagnostic = {
      apiVersion: "velero.io/v1",
      kind: "DownloadRequest",
      metadata: { ...attempted.metadata, name: `denied-download-${run}` },
      spec: { target: { kind: "BackupLog", name: names.backup } },
    };
    const diagnosticCreation = asReader(
      ["create", "--raw", `/apis/velero.io/v1/namespaces/${names.static}/downloadrequests`, "-f", "-"],
      JSON.stringify(diagnostic),
    );

    requireCondition(
      diagnosticCreation.status === 1 && diagnosticCreation.stderr.toLowerCase().includes("forbidden"),
      "The restricted identity was allowed to create a diagnostic request",
    );
    denied += 1;
    const snapshots = JSON.parse(readFileSync(join(STATE, "fixture-static-snapshots.json"), "utf8")) as KubeResource[];

    verifyStaticFixtures(runtime, [...snapshots, missingLocation]);
    writeFileSync(
      join(STATE, "fixture-permission-result.json"),
      JSON.stringify({
        run,
        allowedReads: 1,
        forbiddenOperations: denied,
        syntheticObjectsUnchanged: snapshots.length + 1,
        missingLocationFixture: true,
      }),
      { mode: 0o600 },
    );
  } finally {
    unlinkSync(readerFile);
  }
  journal.fixtureRun.phase = "permissions-verified";
  save();
  console.log(
    `PASS: namespace-only reader allowed; ${denied} forbidden operations rejected, missing-location fixture present and synthetic states unchanged. Temporary kubeconfig removed.`,
  );
}

async function cleanupFixtures(): Promise<void> {
  verifyPreloadedImages();
  requireCondition(journal.fixtureRun, "No fixture run is recorded");
  const run = journal.fixtureRun.id;
  const names = fixtureNames(run);
  const identity = (kind: string, name: string, namespace?: string) =>
    journal.resources.find((entry) => entry.kind === kind && entry.name === name && entry.namespace === namespace);
  const existing = (entry: ResourceIdentity) => {
    const raw = kubectl(["get", ...resourceArguments(entry), "--ignore-not-found", "-o", "json"]);

    if (!raw.trim()) return undefined;
    const resource = JSON.parse(raw) as KubeResource;

    assertOwnedResource(journal.owner, resource, entry.uid);
    requireCondition(
      resource.metadata.labels?.[FIXTURE_LABEL] === run,
      "Cleanup resource belongs to a different fixture run",
    );
    return resource;
  };
  journal.fixtureRun.phase = "cleanup";
  save();
  const backupEntry = identity("Backup", names.backup, DEMO_NAMESPACE);

  if (backupEntry && existing(backupEntry)) {
    const backup = existing(backupEntry);

    requireCondition(
      backup &&
        ["Completed", "PartiallyFailed", "Failed", "FailedValidation"].includes(
          (backup.status as { phase: string }).phase,
        ),
      "Cannot clean an in-progress fixture backup",
    );
    const restores = JSON.parse(
      kubectl(["get", "restores.velero.io", "--namespace", DEMO_NAMESPACE, "-o", "json"]),
    ) as { items: (KubeResource & { spec: { backupName?: string } })[] };

    for (const restore of restores.items.filter((item) => item.spec.backupName === names.backup)) {
      assertOwnedResource(journal.owner, restore, identity("Restore", restore.metadata.name, DEMO_NAMESPACE)?.uid);
      requireCondition(
        restore.metadata.labels?.[FIXTURE_LABEL] === run,
        "An unrelated Restore references this backup; deletion refused",
      );
    }
    kubectl(
      [
        "wait",
        "--for=jsonpath={.status.phase}=Available",
        "backupstoragelocation/default",
        "--namespace",
        DEMO_NAMESPACE,
        "--timeout=180s",
      ],
      undefined,
      210_000,
    );
    const priorDeletion = identity("DeleteBackupRequest", `${names.backup}-delete`, DEMO_NAMESPACE);

    if (priorDeletion) {
      const prior = existing(priorDeletion);
      const priorStatus = prior?.status as { phase?: string; errors?: string[] } | undefined;

      if (prior && priorStatus?.phase === "Processed" && priorStatus.errors?.length) {
        kubectl(
          [
            "delete",
            "--raw",
            `/apis/velero.io/v1/namespaces/${DEMO_NAMESPACE}/deletebackuprequests/${priorDeletion.name}`,
            "-f",
            "-",
          ],
          JSON.stringify({ apiVersion: "v1", kind: "DeleteOptions", preconditions: { uid: prior.metadata.uid } }),
          undefined,
          false,
        );
        journal.resources = journal.resources.filter((item) => item !== priorDeletion);
        save();
      }
    }
    applyOwned(fixtureDeletionRequest(journal.owner, run, backup.metadata.uid ?? ""));
    const deletion = identity("DeleteBackupRequest", `${names.backup}-delete`, DEMO_NAMESPACE);

    requireCondition(deletion, "Deletion request ownership was not recorded");
    const deadline = Date.now() + 180_000;

    while (existing(backupEntry)) {
      const request = existing(deletion);
      const errors = (request?.status as { errors?: string[] } | undefined)?.errors;

      requireCondition(!errors?.length, "The controller reported a fixture backup-deletion error");
      requireCondition(Date.now() < deadline, "Fixture backup deletion timed out");
      await delay(1000);
    }
  }
  for (const [kind, name] of [
    ["Backup", names.backup],
    ["Restore", names.restore],
    ["DeleteBackupRequest", `${names.backup}-delete`],
  ]) {
    const entry = identity(kind, name, DEMO_NAMESPACE);

    if (entry) {
      requireCondition(!existing(entry), "Controller cleanup has not removed all fixture operation resources");
      journal.resources = journal.resources.filter((item) => item !== entry);
      save();
    }
  }
  const credentials = JSON.parse(readFileSync(join(STATE, "credentials.json"), "utf8")) as { velero: Credentials };

  for (const path of Object.values(fixtureArtifactPaths(run)))
    requireCondition(
      storageRequest("HEAD", path, credentials.velero).code === 404,
      "A fixture backup/restore artifact remains after controller cleanup",
    );
  const resources = kubectl(["api-resources", "--namespaced=true", "--verbs=list", "-o", "name"])
    .trim()
    .split("\n")
    .filter(Boolean);

  for (const namespace of [names.source, names.restored, names.static]) {
    const entry = identity("Namespace", namespace);

    if (!entry) continue;
    const current = existing(entry);

    if (current) {
      const inventory = JSON.parse(
        kubectl(["get", resources.join(","), "--namespace", namespace, "--ignore-not-found", "-o", "json"]),
      ) as { items: KubeResource[] };

      assertFixtureNamespaceContents(journal.owner, run, namespace, inventory.items);
      kubectl(
        ["delete", "--raw", `/api/v1/namespaces/${namespace}`, "-f", "-"],
        JSON.stringify({ apiVersion: "v1", kind: "DeleteOptions", preconditions: { uid: current.metadata.uid } }),
      );
      kubectl(["wait", "--for=delete", `namespace/${namespace}`, "--timeout=90s"], undefined, 120_000);
    }
    journal.resources = journal.resources.filter(
      (item) => item.namespace !== namespace && !(item.kind === "Namespace" && item.name === namespace),
    );
    save();
  }
  journal.fixtureRun.phase = "cleaned";
  save();
  writeFileSync(
    join(STATE, "fixture-cleanup-result.json"),
    JSON.stringify({
      run,
      controllerDeletion: true,
      expectedArtifactsAbsent: 5,
      namespacesRemoved: 3,
      unrelatedResourcesPreserved: true,
    }),
    { mode: 0o600 },
  );
  console.log(
    "PASS: real backup, associated restore and stored artifacts removed by the controller; three owned fixture namespaces removed with UID checks. Demo infrastructure retained.",
  );
}

function runDirectProof(input: {
  owner: string;
  run: string;
  pod: { name: string; uid: string };
  origin: string;
  port: number;
}): unknown {
  verifyPreloadedImages();
  const [image] = JSON.parse(docker(["image", "inspect", DIRECT_PROOF_IMAGE])) as {
    Id: string;
    Os: string;
    Architecture: string;
    RepoDigests: string[];
  }[];

  requireCondition(
    image.Os === "linux" &&
      image.Architecture === "amd64" &&
      image.RepoDigests.some((digest) => digest.endsWith(DIRECT_PROOF_IMAGE.split("@")[1])),
    "Official direct-proof runtime identity mismatch",
  );
  const file = join(STATE, "direct-proof-input.json");
  const helper = `velero-direct-${randomBytes(4).toString("hex")}`;

  writeFileSync(file, JSON.stringify({ ...input, kubeconfigHash: journal.kubeconfigHash }), { mode: 0o600 });
  requireCondition(
    !docker(["ps", "-aq", "--filter", `name=^${helper}$`]).trim(),
    "Direct-proof container name collision",
  );
  try {
    const output = docker(
      [
        "run",
        "--rm",
        "--pull=never",
        "--name",
        helper,
        "--label",
        `${OWNER_LABEL}=${journal.owner}`,
        "--label",
        `${FIXTURE_LABEL}=${input.run}`,
        "--network",
        `container:${journal.nodeId}`,
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--memory=512m",
        "--cpus=2",
        `--user=${process.getuid?.()}:${process.getgid?.()}`,
        "--tmpfs",
        "/tmp:rw,nosuid,size=64m",
        "--mount",
        `type=bind,src=${process.cwd()},dst=/proof,readonly`,
        "--mount",
        `type=bind,src=${file},dst=/proof-state/input.json,readonly`,
        "--mount",
        `type=bind,src=${CONFIG},dst=/proof-state/kubeconfig,readonly`,
        "--workdir=/proof",
        "--entrypoint=node",
        DIRECT_PROOF_IMAGE,
        "e2e/scripts/local-download-proof.mts",
        "--direct",
      ],
      undefined,
      300_000,
    );
    const messages = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { result?: unknown; nodeVersion?: string });
    const result = messages.find((message) => message.result);

    requireCondition(result?.nodeVersion === "v24.15.0", "Direct proof runtime version differs");
    return result.result;
  } finally {
    const remaining = docker(["ps", "-aq", "--filter", `name=^${helper}$`]).trim();

    if (remaining) {
      const [container] = JSON.parse(docker(["inspect", remaining])) as {
        Config: { Labels: Record<string, string> };
        Image: string;
        HostConfig: { NetworkMode: string };
      }[];

      requireCondition(
        container.Config.Labels[OWNER_LABEL] === journal.owner &&
          container.Config.Labels[FIXTURE_LABEL] === input.run &&
          container.Image === image.Id &&
          container.HostConfig.NetworkMode === `container:${journal.nodeId}`,
        "Unexpected direct-proof container ownership",
      );
      docker(["rm", "--force", remaining]);
    }
    unlinkSync(file);
  }
}

async function runTransportProof(): Promise<void> {
  verifyPreloadedImages();
  requireCondition(
    !journal.fixtureRun || journal.fixtureRun.phase === "cleaned",
    "Clean the prior fixture run before transport proof",
  );
  delete journal.fixtureRun;
  save();
  const requests: { kind: "DownloadRequest" | "ServerStatusRequest"; name: string; uid: string }[] = [];
  const originals: KubeResource[] = [];
  const secrets: KubeResource[] = [];
  let certificates: Awaited<ReturnType<typeof createTlsFixture>> | undefined;
  let requestCleanupFailed = false;
  const report: Record<string, unknown> = { date: new Date().toISOString(), result: "running", cleanup: "pending" };

  writeFileSync(join(STATE, "transport-proof.json"), JSON.stringify(report), { mode: 0o600 });

  try {
    prepareFixtures();
    await executeLiveFixtures();
    requireCondition(journal.fixtureRun, "Transport fixture run missing");
    const active = journal.fixtureRun as { id: string };
    const pods = JSON.parse(
      kubectl([
        "get",
        "pods",
        "--namespace",
        DEMO_NAMESPACE,
        "--selector",
        `app.kubernetes.io/name=velero-demo-storage,${OWNER_LABEL}=${journal.owner}`,
        "-o",
        "json",
      ]),
    ) as { items: KubeResource[] };

    requireCondition(pods.items.length === 1 && pods.items[0].metadata.uid, "Expected one owned storage pod");
    const proofContext = {
      owner: journal.owner,
      run: active.id,
      kubeconfig: CONFIG,
      pod: { name: pods.items[0].metadata.name, uid: pods.items[0].metadata.uid },
      assertCurrent: verifyTarget,
      record: (
        kind:
          | "DownloadRequest"
          | "ServerStatusRequest"
          | import("../../src/main/diagnostic-kubernetes.ts").DiagnosticKind,
        identity: { name: string; uid: string },
      ) => {
        requireCondition(kind === "DownloadRequest" || kind === "ServerStatusRequest", "Unexpected proof request type");
        requests.push({ kind, ...identity });
        writeFileSync(join(STATE, "transport-requests.json"), JSON.stringify(requests), { mode: 0o600 });
      },
    };
    const http = await runDownloadProof(proofContext);

    for (const resource of ["deployment/seaweedfs", "service/seaweedfs", "backupstoragelocation/default"]) {
      const current = JSON.parse(
        kubectl(["get", resource, "--namespace", DEMO_NAMESPACE, "-o", "json"]),
      ) as KubeResource;

      assertOwnedResource(journal.owner, current);
      originals.push({
        apiVersion: current.apiVersion,
        kind: current.kind,
        metadata: { name: current.metadata.name, namespace: DEMO_NAMESPACE, labels: current.metadata.labels },
        spec: current.spec,
      });
    }
    certificates = await createTlsFixture(new URL(STORAGE_ENDPOINT).hostname);
    const tls = tlsProofResources(journal.owner, active.id, originals, certificates);

    for (const resource of tls) {
      if (resource.kind === "Secret") secrets.push(resource);
      applyOwned(resource);
    }
    kubectl(
      ["rollout", "status", "deployment/seaweedfs", "--namespace", DEMO_NAMESPACE, "--timeout=120s"],
      undefined,
      150_000,
    );
    const readyPods = JSON.parse(
      kubectl([
        "get",
        "pods",
        "--namespace",
        DEMO_NAMESPACE,
        "--selector",
        `app.kubernetes.io/name=velero-demo-storage,${OWNER_LABEL}=${journal.owner}`,
        "-o",
        "json",
      ]),
    ) as { items: KubeResource[] };

    requireCondition(
      readyPods.items.length === 1 && readyPods.items[0].metadata.uid,
      "TLS storage pod identity is ambiguous",
    );
    const tlsContext = {
      ...proofContext,
      pod: { name: readyPods.items[0].metadata.name, uid: readyPods.items[0].metadata.uid },
      origin: STORAGE_ENDPOINT.replace("http:", "https:").replace(":8333", ":8443"),
      port: 8443,
    };
    const inlineCa = await runDownloadProof(tlsContext);
    const location = tls.find((resource) => resource.kind === "BackupStorageLocation");

    requireCondition(location, "TLS storage location missing");
    const objectStorage = (location.spec as { objectStorage: Record<string, unknown> }).objectStorage;

    delete objectStorage.caCert;
    objectStorage.caCertRef = { name: `proof-ca-${active.id}`, key: "ca.crt" };
    applyOwned(location);
    const referencedCa = await runDownloadProof(tlsContext);
    const direct = runDirectProof({
      owner: journal.owner,
      run: active.id,
      pod: tlsContext.pod,
      origin: tlsContext.origin,
      port: tlsContext.port,
    });

    Object.assign(report, {
      http,
      inlineCa,
      referencedCa,
      direct,
      directRuntime: DIRECT_PROOF_IMAGE,
      result: "artifacts-passed",
    });
    writeFileSync(join(STATE, "transport-proof.json"), JSON.stringify(report), { mode: 0o600 });
    console.log(
      "PASS: compiled main downloaded 16 real artifacts through direct HTTPS and HTTP/HTTPS Kubernetes tunnels, with inline/referenced CA and negative signature/Host/CA checks.",
    );
  } finally {
    for (const resource of originals) applyOwned(resource);
    if (originals.length) {
      kubectl(
        ["rollout", "status", "deployment/seaweedfs", "--namespace", DEMO_NAMESPACE, "--timeout=120s"],
        undefined,
        150_000,
      );
      kubectl(
        [
          "wait",
          "--for=jsonpath={.status.phase}=Available",
          "backupstoragelocation/default",
          "--namespace",
          DEMO_NAMESPACE,
          "--timeout=180s",
        ],
        undefined,
        210_000,
      );
    }
    for (const secret of secrets) {
      const entry = journal.resources.find(
        (resource) =>
          resource.kind === "Secret" && resource.name === secret.metadata.name && resource.namespace === DEMO_NAMESPACE,
      );

      if (!entry?.uid) continue;
      kubectl(
        ["delete", "--raw", `/api/v1/namespaces/${DEMO_NAMESPACE}/secrets/${entry.name}`, "-f", "-"],
        JSON.stringify({ apiVersion: "v1", kind: "DeleteOptions", preconditions: { uid: entry.uid } }),
        undefined,
        false,
      );
      journal.resources = journal.resources.filter((resource) => resource !== entry);
      save();
    }
    await certificates?.dispose();
    const main = compiledDiagnostics();
    const api = new main.DiagnosticKubernetes(
      { clusterId: journal.owner, context: DEMO_CONTEXT, kubeconfigPath: CONFIG },
      () => {
        verifyTarget();
        return true;
      },
    );

    if (journal.fixtureRun) {
      const activeRun = journal.fixtureRun as { id: string };

      for (const kind of ["DownloadRequest", "ServerStatusRequest"] as const) {
        const plural = kind === "DownloadRequest" ? "downloadrequests.velero.io" : "serverstatusrequests.velero.io";
        const metadata = JSON.parse(
          kubectl(
            [
              "get",
              plural,
              "--namespace",
              DEMO_NAMESPACE,
              "--selector",
              `${OWNER_LABEL}=${journal.owner},${FIXTURE_LABEL}=${activeRun.id}`,
              "-o=jsonpath-as-json={.items[*].metadata}",
            ],
            undefined,
            undefined,
            false,
          ),
        ) as { name: string; uid: string; labels?: Record<string, string> }[];

        for (const identity of metadata) {
          requireCondition(
            identity.labels?.[OWNER_LABEL] === journal.owner &&
              identity.labels?.[FIXTURE_LABEL] === activeRun.id &&
              identity.uid,
            "Unexpected diagnostic cleanup identity",
          );
          if (!requests.some((item) => item.kind === kind && item.uid === identity.uid))
            requests.push({ kind, name: identity.name, uid: identity.uid });
        }
      }
    }

    for (const identity of requests) {
      let request: Awaited<ReturnType<typeof api.read>>;

      try {
        request = await api.read(identity.kind, DEMO_NAMESPACE, identity.name, new AbortController().signal);
      } catch (error) {
        if (error instanceof main.DiagnosticError && error.code === "not-found") continue;
        requestCleanupFailed = true;
        continue;
      }
      assertOwnedResource(journal.owner, request, identity.uid);
      const resource = identity.kind === "DownloadRequest" ? "downloadrequests" : "serverstatusrequests";

      kubectl(
        ["delete", "--raw", `/apis/velero.io/v1/namespaces/${DEMO_NAMESPACE}/${resource}/${identity.name}`, "-f", "-"],
        JSON.stringify({ apiVersion: "v1", kind: "DeleteOptions", preconditions: { uid: identity.uid } }),
        undefined,
        false,
      );
    }
    if (journal.fixtureRun) await cleanupFixtures();
  }
  requireCondition(
    !requestCleanupFailed,
    "Diagnostic request cleanup was incomplete; private request identities retained",
  );
  await verifyEnvironment();
  Object.assign(report, {
    result: "pass",
    cleanup: "passed",
    environment: "verified",
    completedAt: new Date().toISOString(),
  });
  writeFileSync(join(STATE, "transport-proof.json"), JSON.stringify(report), { mode: 0o600 });
}

async function runFixtureSuite(): Promise<void> {
  verifyPreloadedImages();
  requireCondition(
    !journal.fixtureRun || journal.fixtureRun.phase === "cleaned",
    "An unfinished fixture run must be cleaned before starting another",
  );
  delete journal.fixtureRun;
  save();
  let checksPassed = false;

  try {
    prepareFixtures();
    await executeLiveFixtures();
    verifyFixtureArtifacts();
    verifyFixturePermissions();
    checksPassed = true;
  } finally {
    if (journal.fixtureRun) {
      const active = journal.fixtureRun as { id: string; started: string; phase: string };

      await cleanupFixtures();
      const reports: Record<string, unknown> = {};

      for (const name of ["live", "artifact", "permission", "cleanup"]) {
        const path = join(STATE, `fixture-${name}-result.json`);

        if (existsSync(path)) {
          const report = JSON.parse(readFileSync(path, "utf8")) as { run?: string };

          if (report.run === active.id) reports[name] = report;
        }
      }
      const directory = join(STATE, "fixture-runs");

      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeFileSync(
        join(directory, `${active.id}.json`),
        JSON.stringify(
          {
            run: active.id,
            started: active.started,
            completed: new Date().toISOString(),
            checksPassed,
            cleanupPassed: true,
            reports,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    }
  }
  await verifyEnvironment();
  console.log(
    "PASS: T0.5 fixture suite completed, all test resources cleaned and the retained local environment revalidated.",
  );
}

function startCluster(): void {
  preflight();
  const [network] = JSON.parse(docker(["network", "inspect", DEMO_NETWORK])) as KindNetwork[];
  const current = nodes();

  if (current.length === 1 && current[0].State.Running) {
    verifyTarget();
  } else {
    assertStoppedKind(journal, current, network, hash(CONFIG));
    docker(["update", "--restart=no", journal.nodeId]);
    docker(["start", journal.nodeId]);
  }
  verifyTarget();
  docker(
    [
      "exec",
      journal.nodeId,
      "curl",
      "--silent",
      "--show-error",
      "--fail",
      "--retry",
      "30",
      "--retry-delay",
      "1",
      "--retry-connrefused",
      "--max-time",
      "3",
      "--cacert",
      "/etc/kubernetes/pki/ca.crt",
      "--cert",
      "/etc/kubernetes/pki/apiserver-kubelet-client.crt",
      "--key",
      "/etc/kubernetes/pki/apiserver-kubelet-client.key",
      "https://127.0.0.1:6443/livez",
    ],
    undefined,
    120_000,
  );
  setupCluster();
  console.log("PASS: resumed only the recorded initialized node and revalidated its local isolation.");
}

function stopCluster(): void {
  verifyTarget();
  docker(["stop", "--time", "30", journal.nodeId], undefined, 60_000);
  journal.phase = "stopped";
  save();
  console.log("PASS: stopped only the owned demo node; no cluster or data was deleted.");
}

async function main(): Promise<void> {
  const [action, flag, context, ...extra] = process.argv.slice(2);

  requireCondition(
    [
      "cluster",
      "storage",
      "bucket",
      "velero",
      "verify",
      "transport-proof",
      "fixtures",
      "fixtures-static",
      "fixtures-live",
      "fixtures-artifacts",
      "fixtures-permissions",
      "fixtures-cleanup",
      "start",
      "stop",
      "remove-failed-node",
    ].includes(action) &&
      flag === "--context" &&
      context === DEMO_CONTEXT &&
      !extra.length,
    `Usage: node e2e/scripts/local-demo.mts <cluster|storage|bucket|velero|verify|transport-proof|fixtures|fixtures-static|fixtures-live|fixtures-artifacts|fixtures-permissions|fixtures-cleanup|start|stop|remove-failed-node> --context ${DEMO_CONTEXT}`,
  );
  let lock: number | undefined;

  try {
    lock = initialize();
    if (action === "cluster") setupCluster();
    else if (action === "storage") installStorage();
    else if (action === "bucket") prepareBucket();
    else if (action === "velero") installVelero();
    else if (action === "verify") await verifyEnvironment();
    else if (action === "transport-proof") await runTransportProof();
    else if (action === "fixtures") await runFixtureSuite();
    else if (action === "fixtures-static") prepareFixtures();
    else if (action === "fixtures-live") await executeLiveFixtures();
    else if (action === "fixtures-artifacts") verifyFixtureArtifacts();
    else if (action === "fixtures-permissions") verifyFixturePermissions();
    else if (action === "fixtures-cleanup") await cleanupFixtures();
    else if (action === "start") startCluster();
    else if (action === "remove-failed-node") removeFailedNode();
    else stopCluster();
  } finally {
    if (lock !== undefined) {
      closeSync(lock);
      unlinkSync(join(STATE, "run.lock"));
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local demo failed; private diagnostics retained");
  process.exitCode = 1;
}
