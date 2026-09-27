import { BlockList, isIPv4 } from "node:net";

export const DEMO_CLUSTER = "freelens-velero-dev";
export const DEMO_CONTEXT = `kind-${DEMO_CLUSTER}`;
export const DEMO_NAMESPACE = "velero-demo";
export const DEMO_NETWORK = "freelens-velero-dev";
export const DEMO_BRIDGE = "br-velero-dev";
export const DOCKER_HOST = "unix:///var/run/docker.sock";
export const OWNER_LABEL = "freelensapp.io/velero-demo-owner";
export const SUBNETS = {
  docker: "198.18.64.0/24",
  pods: "198.19.0.0/18",
  services: "198.19.64.0/24",
} as const;

export interface DemoIdentity {
  owner: string;
  nodeId: string;
  networkId: string;
  kubeconfigHash: string;
}

export interface KindNode {
  Id: string;
  State: { Running: boolean };
  Config: { Labels: Record<string, string> };
  NetworkSettings: {
    Networks: Record<string, { NetworkID: string; IPAddress?: string }>;
    Ports: Record<string, { HostIp: string; HostPort: string }[] | null>;
  };
}

export interface KindNetwork {
  Id: string;
  Labels: Record<string, string>;
  Internal: boolean;
  Driver: string;
  IPAM: { Config: { Subnet: string }[] };
}

export interface KindConfig {
  "current-context": string;
  contexts: { name: string; context: { cluster: string; user: string } }[];
  clusters: {
    name: string;
    cluster: { server: string; "insecure-skip-tls-verify"?: boolean; "certificate-authority-data"?: string };
  }[];
  users: { name: string; user: Record<string, unknown> }[];
}

export function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function localEnvironment(base: NodeJS.ProcessEnv, kubeconfig: string): NodeJS.ProcessEnv {
  const environment = { ...base };

  for (const key of [
    "DOCKER_CONTEXT",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    "KUBERNETES_MASTER",
    "KUBERNETES_SERVICE_HOST",
    "KUBERNETES_SERVICE_PORT",
    "NODE_OPTIONS",
  ]) {
    delete environment[key];
  }

  for (const key of Object.keys(environment)) {
    if (
      /^(AWS_|AZURE_|ARM_|GOOGLE_|GCLOUD_|GCP_|CLOUDSDK_|WEED_|VELERO_|DOCKER_|KIND_|TRIVY_)/i.test(key) ||
      /^(https?|all|no)_proxy$/i.test(key)
    ) {
      delete environment[key];
    }
  }

  return {
    ...environment,
    DOCKER_HOST,
    KIND_EXPERIMENTAL_PROVIDER: "docker",
    KIND_EXPERIMENTAL_DOCKER_NETWORK: DEMO_NETWORK,
    KUBECONFIG: kubeconfig,
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_CONFIG_FILE: "/dev/null",
    AWS_SHARED_CREDENTIALS_FILE: "/dev/null",
  };
}

export function assertFailedNodeRemoval(
  identity: DemoIdentity,
  nodes: KindNode[],
  network: KindNetwork,
  resourceCount: number,
  hasKubeconfig: boolean,
): void {
  requireCondition(identity.owner && identity.nodeId && identity.networkId, "Incomplete bootstrap ownership");
  requireCondition(
    !identity.kubeconfigHash && !hasKubeconfig && resourceCount === 0,
    "Only an uninitialized bootstrap node may be removed",
  );
  requireCondition(nodes.length === 1, "Expected exactly one failed demo node");
  const node = nodes[0];

  requireCondition(
    node.Id === identity.nodeId && node.State?.Running === false,
    "Failed node must be unchanged and stopped",
  );
  requireCondition(
    node.Config?.Labels?.["io.x-k8s.kind.cluster"] === DEMO_CLUSTER &&
      node.Config.Labels["io.x-k8s.kind.role"] === "control-plane",
    "Wrong failed-node identity",
  );
  requireCondition(
    network.Id === identity.networkId && network.Labels?.[OWNER_LABEL] === identity.owner && network.Internal,
    "Wrong failed-node network owner",
  );
  requireCondition(
    Object.keys(node.NetworkSettings?.Networks ?? {}).length === 1 &&
      node.NetworkSettings.Networks[DEMO_NETWORK]?.NetworkID === identity.networkId,
    "Unexpected failed-node network attachment",
  );
}

export function assertOwnedNetwork(identity: Pick<DemoIdentity, "owner" | "networkId">, network: KindNetwork): void {
  requireCondition(identity.owner && identity.networkId, "Incomplete network ownership");
  requireCondition(
    network.Id === identity.networkId && network.Labels?.[OWNER_LABEL] === identity.owner,
    "Wrong network owner",
  );
  requireCondition(network.Internal && network.Driver === "bridge", "An internal Docker bridge is required");
  requireCondition(
    network.IPAM?.Config?.length === 1 && network.IPAM.Config[0].Subnet === SUBNETS.docker,
    "Unexpected Docker subnet",
  );
}

export function assertStoppedKind(
  identity: DemoIdentity,
  nodes: KindNode[],
  network: KindNetwork,
  configHash: string,
): void {
  assertOwnedNetwork(identity, network);
  requireCondition(
    identity.nodeId && identity.kubeconfigHash && configHash === identity.kubeconfigHash,
    "Initialized node and unchanged kubeconfig are required for resume",
  );
  requireCondition(
    nodes.length === 1 && nodes[0].Id === identity.nodeId && nodes[0].State.Running === false,
    "Only the unchanged stopped node may be resumed",
  );
  const node = nodes[0];

  requireCondition(
    node.Config.Labels["io.x-k8s.kind.cluster"] === DEMO_CLUSTER &&
      node.Config.Labels["io.x-k8s.kind.role"] === "control-plane",
    "Wrong resume target",
  );
  requireCondition(
    Object.keys(node.NetworkSettings.Networks).length === 1 &&
      node.NetworkSettings.Networks[DEMO_NETWORK]?.NetworkID === identity.networkId,
    "Resume target has an unexpected network",
  );
}

export function assertLocalKind(
  identity: DemoIdentity,
  nodes: KindNode[],
  network: KindNetwork,
  config: KindConfig,
  configHash: string,
): void {
  requireCondition(
    identity.owner && identity.nodeId && identity.networkId && identity.kubeconfigHash,
    "Incomplete ownership journal",
  );
  requireCondition(nodes.length === 1, "Expected exactly one dedicated kind node");
  const node = nodes[0];

  requireCondition(
    node.Id === identity.nodeId && node.State?.Running,
    "Owned kind node is missing, replaced or stopped",
  );
  requireCondition(node.Config?.Labels?.["io.x-k8s.kind.cluster"] === DEMO_CLUSTER, "Wrong kind cluster");
  requireCondition(node.Config?.Labels?.["io.x-k8s.kind.role"] === "control-plane", "Wrong kind node role");
  assertOwnedNetwork(identity, network);
  requireCondition(
    Object.keys(node.NetworkSettings?.Networks ?? {}).length === 1,
    "Additional node networks are forbidden",
  );
  requireCondition(
    node.NetworkSettings?.Networks?.[DEMO_NETWORK]?.NetworkID === identity.networkId,
    "Node is outside the owned network",
  );
  requireCondition(configHash === identity.kubeconfigHash, "Kubeconfig changed since creation");
  requireCondition(
    config.contexts?.length === 1 && config.clusters?.length === 1 && config.users?.length === 1,
    "Kubeconfig must contain one target",
  );
  const context = config.contexts[0];
  const cluster = config.clusters[0];
  const user = config.users[0];

  requireCondition(config["current-context"] === DEMO_CONTEXT && context.name === DEMO_CONTEXT, "Wrong kube context");
  requireCondition(
    context.context?.cluster === cluster.name && context.context?.user === user.name,
    "Invalid kubeconfig bindings",
  );
  requireCondition(cluster.name === DEMO_CONTEXT && user.name === DEMO_CONTEXT, "Unexpected kubeconfig identity");
  requireCondition(
    cluster.cluster?.["certificate-authority-data"] && !cluster.cluster["insecure-skip-tls-verify"],
    "Verified cluster TLS is required",
  );
  requireCondition(
    Object.keys(cluster.cluster).every((key) => ["server", "certificate-authority-data"].includes(key)),
    "Unexpected cluster transport settings",
  );
  requireCondition(
    user.user?.["client-certificate-data"] &&
      user.user?.["client-key-data"] &&
      !user.user.exec &&
      !user.user["auth-provider"],
    "Only generated kind credentials are allowed",
  );
  requireCondition(
    Object.keys(user.user).every((key) => ["client-certificate-data", "client-key-data"].includes(key)),
    "Unexpected credential settings",
  );
  const ports = node.NetworkSettings?.Ports?.["6443/tcp"];

  if (ports?.length) {
    requireCondition(
      ports.length === 1 && ports[0].HostIp === "127.0.0.1",
      "Published API server must bind only to loopback",
    );
    requireCondition(/^\d+$/.test(ports[0].HostPort), "Invalid API port");
    requireCondition(
      cluster.cluster.server === `https://127.0.0.1:${ports[0].HostPort}`,
      "Kubeconfig does not address the owned node",
    );
  } else {
    const address = node.NetworkSettings.Networks[DEMO_NETWORK].IPAddress;

    requireCondition(
      address && isIPv4(address) && address.startsWith("198.18.64."),
      "Invalid owned internal API address",
    );
    requireCondition(
      cluster.cluster.server === `https://${address}:6443`,
      "Kubeconfig does not address the owned internal node",
    );
  }
}

function parseSubnet(cidr: string): { address: string; prefix: number } {
  const parts = cidr.split("/");
  const prefix = parts.length === 1 ? 32 : Number(parts[1]);

  requireCondition(
    parts.length <= 2 &&
      isIPv4(parts[0]) &&
      (parts.length === 1 || /^\d+$/.test(parts[1])) &&
      Number.isInteger(prefix) &&
      prefix >= 0 &&
      prefix <= 32,
    "Invalid IPv4 subnet",
  );
  return { address: parts[0], prefix };
}

export function subnetsOverlap(first: string, second: string): boolean {
  const firstSubnet = parseSubnet(first);
  const secondSubnet = parseSubnet(second);
  const firstBlock = new BlockList();
  const secondBlock = new BlockList();

  firstBlock.addSubnet(firstSubnet.address, firstSubnet.prefix, "ipv4");
  secondBlock.addSubnet(secondSubnet.address, secondSubnet.prefix, "ipv4");

  return firstBlock.check(secondSubnet.address, "ipv4") || secondBlock.check(firstSubnet.address, "ipv4");
}

export function assertOwnedResource(
  owner: string,
  resource: { metadata?: { uid?: string; labels?: Record<string, string> } },
  expectedUid?: string,
): void {
  requireCondition(owner && resource.metadata?.labels?.[OWNER_LABEL] === owner, "Resource is not owned by this demo");
  requireCondition(
    resource.metadata.uid && (!expectedUid || resource.metadata.uid === expectedUid),
    "Resource identity changed",
  );
}
