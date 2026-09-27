import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  allowsFixtureArtifact,
  assertFixtureNamespaceContents,
  BACKUP_PHASES,
  FIXTURE_LABEL,
  FIXTURE_MODE,
  fixtureArtifactPaths,
  fixtureDeletionRequest,
  fixtureNames,
  liveBackup,
  liveRestore,
  RESTORE_PHASES,
  restrictedFixtures,
  staticFixtures,
} from "../e2e/scripts/local-fixtures.mts";
import {
  assertFailedNodeRemoval,
  assertLocalKind,
  assertOwnedNetwork,
  assertOwnedResource,
  assertStoppedKind,
  DEMO_CLUSTER,
  DEMO_CONTEXT,
  DEMO_NETWORK,
  type DemoIdentity,
  DOCKER_HOST,
  type KindConfig,
  type KindNetwork,
  type KindNode,
  localEnvironment,
  OWNER_LABEL,
  SUBNETS,
  subnetsOverlap,
} from "../e2e/scripts/local-kind.mts";
import {
  BUCKET,
  IMAGES,
  KIND_HOSTS,
  kindConfiguration,
  preloadedImage,
  prepareVeleroResources,
  STORAGE_ENDPOINT,
  storageConfiguration,
  storageManifests,
} from "../e2e/scripts/local-manifests.mts";
import { assertOfficialImages, binaryReportHasNoCalls, IMAGE_NAMES } from "../e2e/scripts/local-security.mts";

describe("foundation fixture boundaries", () => {
  const run = "a1b2c3d4";

  it("covers every reviewed phase only in the synthetic namespace", () => {
    const resources = staticFixtures("synthetic-owner", run);

    expect(
      resources
        .filter((resource) => resource.kind === "Backup")
        .map((resource) => (resource.status as { phase: string }).phase),
    ).toEqual([...BACKUP_PHASES]);
    expect(
      resources
        .filter((resource) => resource.kind === "Restore")
        .map((resource) => (resource.status as { phase: string }).phase),
    ).toEqual([...RESTORE_PHASES]);
    expect(BACKUP_PHASES).toHaveLength(13);
    expect(RESTORE_PHASES).toHaveLength(10);
    expect(resources.every((resource) => resource.metadata.labels?.[FIXTURE_MODE] === "synthetic")).toBe(true);
    expect(
      resources
        .filter((resource) => resource.kind !== "Namespace")
        .every((resource) => resource.metadata.namespace === fixtureNames(run).static),
    ).toBe(true);
    expect(resources.find((resource) => resource.metadata.name === "backup-finalizing")?.status).toMatchObject({
      phase: "Finalizing",
      progress: { itemsBackedUp: 10, totalItems: 10 },
    });
    expect(resources.find((resource) => resource.metadata.name === "backup-new")?.status).not.toHaveProperty(
      "startTimestamp",
    );
  });

  it("keeps live operations narrowly scoped and separate from forced status", () => {
    const names = fixtureNames(run);
    const backup = liveBackup("synthetic-owner", run);
    const restore = liveRestore("synthetic-owner", run);

    expect(backup).not.toHaveProperty("status");
    expect(restore).not.toHaveProperty("status");
    expect(backup.spec).toMatchObject({
      includedNamespaces: [names.source],
      includedResources: ["configmaps"],
      includeClusterResources: false,
      storageLocation: "default",
    });
    expect(restore.spec).toMatchObject({
      backupName: names.backup,
      namespaceMapping: { [names.source]: names.restored },
      existingResourcePolicy: "none",
    });
    expect(() => fixtureNames("personal-namespace")).toThrow();
    expect(() => staticFixtures("", run)).toThrow();
  });

  it("allows fixture logs/results but never an archive download or another run", () => {
    const paths = fixtureArtifactPaths(run);

    expect(paths.restoreLog).toBe(
      `/velero-demo/restores/fixture-restore-${run}/restore-fixture-restore-${run}-logs.gz`,
    );
    expect(allowsFixtureArtifact("GET", paths.backupLog, run)).toBe(true);
    expect(allowsFixtureArtifact("HEAD", paths.archive, run)).toBe(true);
    expect(allowsFixtureArtifact("GET", paths.archive, run)).toBe(false);
    expect(allowsFixtureArtifact("GET", paths.backupLog, "b1b2b3b4")).toBe(false);
    expect(allowsFixtureArtifact("DELETE", paths.backupLog, run)).toBe(false);
  });

  it("grants only namespaced Velero reads and supplies a dangling-location case", () => {
    const resources = restrictedFixtures("synthetic-owner", run);
    const role = resources.find((resource) => resource.kind === "Role");

    expect(role?.rules).toEqual([
      {
        apiGroups: ["velero.io"],
        resources: ["backups", "restores", "schedules", "backupstoragelocations"],
        verbs: ["get", "list", "watch"],
      },
    ]);
    expect(resources.some((resource) => resource.kind === "ClusterRoleBinding")).toBe(false);
    expect(resources[0].spec).toMatchObject({ storageLocation: "fixture-missing-location" });
    expect(resources[0].metadata.labels?.[FIXTURE_MODE]).toBe("synthetic");
  });

  it("refuses namespace cleanup with unrelated resources and binds backup deletion to its UID", () => {
    const namespace = fixtureNames(run).source;
    const resource = {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: "payload", namespace, labels: { [OWNER_LABEL]: "synthetic-owner", [FIXTURE_LABEL]: run } },
    };

    expect(() => assertFixtureNamespaceContents("synthetic-owner", run, namespace, [resource])).not.toThrow();
    expect(() => assertFixtureNamespaceContents("synthetic-owner", run, "velero-demo", [resource])).toThrow();
    expect(() =>
      assertFixtureNamespaceContents("synthetic-owner", run, namespace, [
        { ...resource, metadata: { ...resource.metadata, labels: {} } },
      ]),
    ).toThrow();
    const request = fixtureDeletionRequest("synthetic-owner", run, "synthetic-backup-uid");

    expect(request.kind).toBe("DeleteBackupRequest");
    expect(request.metadata.labels?.["velero.io/backup-uid"]).toBe("synthetic-backup-uid");
    expect(() => fixtureDeletionRequest("synthetic-owner", run, "")).toThrow();
  });
});

function fixture() {
  const identity: DemoIdentity = {
    owner: "synthetic-owner",
    nodeId: "synthetic-node",
    networkId: "synthetic-network",
    kubeconfigHash: "synthetic-hash",
  };
  const network: KindNetwork = {
    Id: identity.networkId,
    Labels: { [OWNER_LABEL]: identity.owner },
    Internal: true,
    Driver: "bridge",
    IPAM: { Config: [{ Subnet: SUBNETS.docker }] },
  };
  const node: KindNode = {
    Id: identity.nodeId,
    State: { Running: true },
    Config: { Labels: { "io.x-k8s.kind.cluster": DEMO_CLUSTER, "io.x-k8s.kind.role": "control-plane" } },
    NetworkSettings: {
      Networks: { [DEMO_NETWORK]: { NetworkID: identity.networkId } },
      Ports: { "6443/tcp": [{ HostIp: "127.0.0.1", HostPort: "16443" }] },
    },
  };
  const config: KindConfig = {
    "current-context": DEMO_CONTEXT,
    contexts: [{ name: DEMO_CONTEXT, context: { cluster: DEMO_CONTEXT, user: DEMO_CONTEXT } }],
    clusters: [
      {
        name: DEMO_CONTEXT,
        cluster: { server: "https://127.0.0.1:16443", "certificate-authority-data": "synthetic-ca" },
      },
    ],
    users: [
      { name: DEMO_CONTEXT, user: { "client-certificate-data": "synthetic-cert", "client-key-data": "synthetic-key" } },
    ],
  };

  return { identity, network, nodes: [node], config };
}

describe("local kind safety boundary", () => {
  it("resumes only the unchanged, isolated, stopped initialized node", () => {
    const { identity, nodes, network } = fixture();

    expect(() => assertStoppedKind(identity, nodes, network, identity.kubeconfigHash)).toThrow();
    nodes[0].State.Running = false;
    expect(() => assertStoppedKind(identity, nodes, network, identity.kubeconfigHash)).not.toThrow();
    expect(() => assertStoppedKind(identity, nodes, network, "changed")).toThrow();
    expect(() =>
      assertStoppedKind({ ...identity, nodeId: "replacement" }, nodes, network, identity.kubeconfigHash),
    ).toThrow();
    expect(() =>
      assertStoppedKind(identity, nodes, { ...network, Internal: false }, identity.kubeconfigHash),
    ).toThrow();
  });

  it("checks retained network ownership before creating a replacement node", () => {
    const { identity, network } = fixture();

    expect(() => assertOwnedNetwork(identity, network)).not.toThrow();
    expect(() => assertOwnedNetwork({ ...identity, networkId: "replaced" }, network)).toThrow();
    expect(() => assertOwnedNetwork(identity, { ...network, Internal: false })).toThrow();
    expect(() => assertOwnedNetwork(identity, { ...network, Labels: {} })).toThrow();
    expect(() =>
      assertOwnedNetwork(identity, { ...network, IPAM: { Config: [{ Subnet: "192.0.2.0/24" }] } }),
    ).toThrow();
  });

  it("accepts only the fully bound owned local target", () => {
    const { identity, network, nodes, config } = fixture();

    expect(() => assertLocalKind(identity, nodes, network, config, identity.kubeconfigHash)).not.toThrow();
  });

  it("allows an unpublished internal API only at the exact owned node address", () => {
    const { identity, nodes, network, config } = fixture();

    nodes[0].NetworkSettings.Ports["6443/tcp"] = null;
    nodes[0].NetworkSettings.Networks[DEMO_NETWORK].IPAddress = "198.18.64.2";
    config.clusters[0].cluster.server = "https://198.18.64.2:6443";
    expect(() => assertLocalKind(identity, nodes, network, config, identity.kubeconfigHash)).not.toThrow();
    config.clusters[0].cluster.server = "https://198.18.64.3:6443";
    expect(() => assertLocalKind(identity, nodes, network, config, identity.kubeconfigHash)).toThrow();
    config.clusters[0].cluster.server = "https://198.18.64.2:6443";
    network.Internal = false;
    expect(() => assertLocalKind(identity, nodes, network, config, identity.kubeconfigHash)).toThrow();
  });

  it.each([
    [
      "another kind cluster",
      (value: ReturnType<typeof fixture>) => {
        value.nodes[0].Config.Labels["io.x-k8s.kind.cluster"] = "kind";
      },
    ],
    [
      "replaced node",
      (value: ReturnType<typeof fixture>) => {
        value.nodes[0].Id = "replacement";
      },
    ],
    [
      "stopped node",
      (value: ReturnType<typeof fixture>) => {
        value.nodes[0].State.Running = false;
      },
    ],
    [
      "another network owner",
      (value: ReturnType<typeof fixture>) => {
        value.network.Labels[OWNER_LABEL] = "different-owner";
      },
    ],
    [
      "non-internal network",
      (value: ReturnType<typeof fixture>) => {
        value.network.Internal = false;
      },
    ],
    [
      "unexpected subnet",
      (value: ReturnType<typeof fixture>) => {
        value.network.IPAM.Config[0].Subnet = "192.0.2.0/24";
      },
    ],
    [
      "extra network attachment",
      (value: ReturnType<typeof fixture>) => {
        value.nodes[0].NetworkSettings.Networks.other = { NetworkID: "other" };
      },
    ],
    [
      "remote endpoint",
      (value: ReturnType<typeof fixture>) => {
        value.config.clusters[0].cluster.server = "https://example.invalid:6443";
      },
    ],
    [
      "wrong loopback port",
      (value: ReturnType<typeof fixture>) => {
        value.config.clusters[0].cluster.server = "https://127.0.0.1:26443";
      },
    ],
    [
      "public API binding",
      (value: ReturnType<typeof fixture>) => {
        const ports = value.nodes[0].NetworkSettings.Ports["6443/tcp"];
        if (ports) ports[0].HostIp = "0.0.0.0";
      },
    ],
    [
      "extra context",
      (value: ReturnType<typeof fixture>) => {
        value.config.contexts.push(structuredClone(value.config.contexts[0]));
      },
    ],
    [
      "unverified TLS",
      (value: ReturnType<typeof fixture>) => {
        value.config.clusters[0].cluster["insecure-skip-tls-verify"] = true;
      },
    ],
    [
      "exec credentials",
      (value: ReturnType<typeof fixture>) => {
        value.config.users[0].user.exec = { command: "unexpected" };
      },
    ],
    [
      "extra credentials",
      (value: ReturnType<typeof fixture>) => {
        value.config.users[0].user.token = "synthetic-token";
      },
    ],
    [
      "proxy configuration",
      (value: ReturnType<typeof fixture>) => {
        Object.assign(value.config.clusters[0].cluster, { "proxy-url": "https://example.invalid" });
      },
    ],
  ] as const)("rejects %s before a cluster request", (_name, mutate) => {
    const value = fixture();

    mutate(value);
    expect(() =>
      assertLocalKind(value.identity, value.nodes, value.network, value.config, value.identity.kubeconfigHash),
    ).toThrow();
  });

  it("rejects missing, ambiguous and changed local identities", () => {
    const { identity, network, nodes, config } = fixture();

    expect(() => assertLocalKind(identity, [], network, config, identity.kubeconfigHash)).toThrow();
    expect(() => assertLocalKind(identity, [...nodes, ...nodes], network, config, identity.kubeconfigHash)).toThrow();
    expect(() => assertLocalKind(identity, nodes, network, config, "changed-hash")).toThrow();
  });

  it("replaces inherited remote Docker and kubeconfig settings without changing the caller", () => {
    const original = {
      DOCKER_HOST: "ssh://example.invalid",
      DOCKER_CONTEXT: "other",
      KUBECONFIG: "personal",
      KUBERNETES_MASTER: "https://example.invalid",
    };
    const environment = localEnvironment(original, "/synthetic-private/kubeconfig");

    expect(environment.DOCKER_HOST).toBe(DOCKER_HOST);
    expect(environment.DOCKER_CONTEXT).toBeUndefined();
    expect(environment.KUBERNETES_MASTER).toBeUndefined();
    expect(environment.KUBECONFIG).toBe("/synthetic-private/kubeconfig");
    expect(original.KUBECONFIG).toBe("personal");
  });

  it("does not inherit cloud credentials or permit ambient metadata lookup", () => {
    const original = {
      AWS_ACCESS_KEY_ID: "synthetic-external-key",
      AWS_SECRET_ACCESS_KEY: "synthetic-external-secret",
      AWS_PROFILE: "synthetic-profile",
      AWS_CONFIG_FILE: "/synthetic-profile",
      AWS_SHARED_CREDENTIALS_FILE: "/synthetic-credentials",
      AWS_EC2_METADATA_DISABLED: "false",
      AZURE_CLIENT_SECRET: "synthetic-azure-secret",
      ARM_CLIENT_ID: "synthetic-identity",
      GOOGLE_APPLICATION_CREDENTIALS: "/synthetic-google-credentials",
    };
    const environment = localEnvironment(original, "/synthetic-private/kubeconfig");

    for (const key of [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_PROFILE",
      "AZURE_CLIENT_SECRET",
      "ARM_CLIENT_ID",
      "GOOGLE_APPLICATION_CREDENTIALS",
    ]) {
      expect(environment[key]).toBeUndefined();
    }
    expect(environment.AWS_EC2_METADATA_DISABLED).toBe("true");
    expect(environment.AWS_CONFIG_FILE).toBe("/dev/null");
    expect(environment.AWS_SHARED_CREDENTIALS_FILE).toBe("/dev/null");
    expect(original.AWS_PROFILE).toBe("synthetic-profile");
  });

  it("removes inherited storage, proxy and runtime overrides", () => {
    const overrides = {
      WEED_MASTER: "example.invalid:9333",
      VELERO_NAMESPACE: "personal-namespace",
      HTTPS_PROXY: "https://example.invalid",
      http_proxy: "http://example.invalid",
      ALL_PROXY: "socks5://example.invalid",
      no_proxy: "example.invalid",
      KUBERNETES_SERVICE_HOST: "example.invalid",
      KUBERNETES_SERVICE_PORT: "443",
      NODE_OPTIONS: "--require=unexpected-module",
      DOCKER_AUTH_CONFIG: "synthetic-registry-credentials",
      KIND_EXPERIMENTAL_CONTAINERD_SNAPSHOTTER: "unexpected",
      TRIVY_DB_REPOSITORY: "example.invalid/private-db",
    };
    const environment = localEnvironment(overrides, "/synthetic-private/kubeconfig");

    for (const key of Object.keys(overrides)) {
      expect(environment[key]).toBeUndefined();
    }
    expect(overrides.WEED_MASTER).toBe("example.invalid:9333");
  });
});

describe("authorized failed-node removal", () => {
  it("accepts only the stopped, owned, uninitialized node", () => {
    const value = fixture();

    value.identity.kubeconfigHash = "";
    value.nodes[0].State.Running = false;
    expect(() => assertFailedNodeRemoval(value.identity, value.nodes, value.network, 0, false)).not.toThrow();
    expect(() => assertFailedNodeRemoval(value.identity, value.nodes, value.network, 1, false)).toThrow();
    expect(() => assertFailedNodeRemoval(value.identity, value.nodes, value.network, 0, true)).toThrow();
    expect(() =>
      assertFailedNodeRemoval(
        { ...value.identity, kubeconfigHash: "initialized" },
        value.nodes,
        value.network,
        0,
        false,
      ),
    ).toThrow();
  });

  it.each(["running", "replaced", "other-cluster", "other-owner", "extra-network"])("rejects %s removal", (variant) => {
    const value = fixture();

    value.identity.kubeconfigHash = "";
    value.nodes[0].State.Running = false;
    if (variant === "running") value.nodes[0].State.Running = true;
    if (variant === "replaced") value.nodes[0].Id = "different";
    if (variant === "other-cluster") value.nodes[0].Config.Labels["io.x-k8s.kind.cluster"] = "kind";
    if (variant === "other-owner") value.network.Labels[OWNER_LABEL] = "different";
    if (variant === "extra-network") value.nodes[0].NetworkSettings.Networks.other = { NetworkID: "different" };
    expect(() => assertFailedNodeRemoval(value.identity, value.nodes, value.network, 0, false)).toThrow();
  });
});

describe("demo network and resource ownership", () => {
  it("detects overlapping routes in either containment direction", () => {
    expect(subnetsOverlap(SUBNETS.docker, "198.18.0.0/15")).toBe(true);
    expect(subnetsOverlap(SUBNETS.docker, "198.18.64.9")).toBe(true);
    expect(subnetsOverlap("198.18.64.9", SUBNETS.docker)).toBe(true);
    expect(subnetsOverlap(SUBNETS.docker, SUBNETS.pods)).toBe(false);
    expect(subnetsOverlap(SUBNETS.pods, SUBNETS.services)).toBe(false);
    expect(() => subnetsOverlap("invalid", SUBNETS.docker)).toThrow();
    expect(() => subnetsOverlap("198.18.64.0/", SUBNETS.docker)).toThrow();
  });

  it("allows updates or cleanup only for an owned, unchanged resource", () => {
    const resource = { metadata: { uid: "fixture-uid", labels: { [OWNER_LABEL]: "fixture-owner" } } };

    expect(() => assertOwnedResource("fixture-owner", resource, "fixture-uid")).not.toThrow();
    expect(() => assertOwnedResource("other-owner", resource)).toThrow();
    expect(() => assertOwnedResource("fixture-owner", resource, "old-uid")).toThrow();
    expect(() => assertOwnedResource("fixture-owner", {})).toThrow();
  });
});

describe("local storage setup contracts", () => {
  const admin = { accessKey: "A".repeat(24), secretKey: "B".repeat(48) };
  const velero = { accessKey: "C".repeat(24), secretKey: "D".repeat(48) };

  it("maps only known digest pins to their official offline tags", () => {
    expect(preloadedImage(IMAGES.storage)).toBe("docker.io/chrislusf/seaweedfs:4.47");
    expect(() => preloadedImage("freelens-velero-lab/storage:custom")).toThrow();
    expect(() => preloadedImage("docker.io/chrislusf/seaweedfs:latest")).toThrow();
  });

  it("preserves upstream CRD schemas and refuses external installer targets", () => {
    const definition = {
      apiVersion: "apiextensions.k8s.io/v1",
      kind: "CustomResourceDefinition",
      metadata: { name: "backups.velero.io" },
      spec: { synthetic: "unchanged" },
    };
    const location = {
      apiVersion: "velero.io/v1",
      kind: "BackupStorageLocation",
      metadata: { name: "default", namespace: "velero-demo" },
      spec: {
        provider: "aws",
        objectStorage: { bucket: BUCKET },
        config: { region: "us-east-1", s3Url: STORAGE_ENDPOINT, s3ForcePathStyle: "true" },
      },
    };
    const resources = prepareVeleroResources("synthetic-owner", { items: [definition, location] });

    expect(resources[0].spec).toEqual(definition.spec);
    expect(resources[1].metadata.labels?.[OWNER_LABEL]).toBe("synthetic-owner");
    expect(definition.metadata).not.toHaveProperty("labels");
    expect(() =>
      prepareVeleroResources("synthetic-owner", {
        items: [{ ...location, metadata: { ...location.metadata, namespace: "other" } }],
      }),
    ).toThrow();
    expect(() =>
      prepareVeleroResources("synthetic-owner", {
        items: [
          {
            ...location,
            spec: { ...location.spec, config: { ...location.spec.config, s3Url: "https://example.invalid" } },
          },
        ],
      }),
    ).toThrow();
  });

  it("keeps installer workloads offline and disables ambient metadata credentials", () => {
    const resource = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "velero", namespace: "velero-demo" },
      spec: {
        template: {
          metadata: {},
          spec: {
            containers: [{ image: preloadedImage(IMAGES.velero) }],
            initContainers: [{ image: preloadedImage(IMAGES.plugin) }],
          },
        },
      },
    };
    const [prepared] = prepareVeleroResources("synthetic-owner", { items: [resource] });

    expect(prepared.spec).toMatchObject({
      template: {
        spec: {
          containers: [
            {
              imagePullPolicy: "Never",
              env: [
                { name: "AWS_EC2_METADATA_DISABLED", value: "true" },
                { name: "AWS_CONFIG_FILE", value: "/dev/null" },
              ],
            },
          ],
          initContainers: [{ imagePullPolicy: "Never" }],
        },
      },
    });
    resource.spec.template.spec.containers[0].image = "unapproved/image:latest";
    expect(() => prepareVeleroResources("synthetic-owner", { items: [resource] })).toThrow();
  });

  it("pins every image and the loopback-only kind API", () => {
    for (const image of Object.values(IMAGES)) expect(image).toMatch(/@sha256:[a-f0-9]{64}$/);
    const configuration = kindConfiguration("/synthetic-private/kind-hosts");

    expect(configuration.networking.apiServerAddress).toBe("127.0.0.1");
    expect(configuration.nodes).toHaveLength(1);
    expect(configuration.nodes[0].extraMounts).toEqual([
      { hostPath: "/synthetic-private/kind-hosts", containerPath: "/etc/hosts", readOnly: false },
    ]);
    expect(KIND_HOSTS).toContain("198.18.64.1 host.docker.internal");
    expect(() => kindConfiguration("relative-hosts")).toThrow();
  });

  it("requires distinct identities and limits the Velero identity to its bucket", () => {
    expect(() => storageConfiguration({ accessKey: "", secretKey: "" }, velero)).toThrow();
    expect(() => storageConfiguration(admin, admin)).toThrow();
    expect(storageConfiguration(admin, velero).identities[1].actions).toEqual([
      `Read:${BUCKET}`,
      `Write:${BUCKET}`,
      `List:${BUCKET}`,
      `Tagging:${BUCKET}`,
    ]);
  });

  it("owns every resource and explicitly hardens storage before startup", () => {
    const resources = storageManifests("synthetic-owner", admin, velero);

    expect(resources.every((resource) => resource.metadata.labels?.[OWNER_LABEL] === "synthetic-owner")).toBe(true);
    const deployment = resources.find((resource) => resource.kind === "Deployment");
    const spec = deployment?.spec as {
      template: {
        spec: { automountServiceAccountToken: boolean; containers: { args: string[]; imagePullPolicy: string }[] };
      };
    };

    expect(spec.template.spec.automountServiceAccountToken).toBe(false);
    expect(spec.template.spec.containers[0].imagePullPolicy).toBe("Never");
    expect(spec.template.spec.containers[0].args).toEqual(
      expect.arrayContaining([
        "-master.telemetry=false",
        "-ip.bind=127.0.0.1",
        "-s3.iam=false",
        "-s3.port.iceberg=0",
        "-s3.port.lance=0",
      ]),
    );
    expect(resources.find((resource) => resource.kind === "Service")?.spec).toMatchObject({
      type: "ClusterIP",
      ports: [{ port: 8333 }],
    });
  });
});

describe("binary vulnerability evidence", () => {
  const report = (level?: string) =>
    JSON.stringify({
      version: "2.1.0",
      runs: [{ tool: { driver: { name: "govulncheck" } }, results: [{ ruleId: "GO-synthetic", level }] }],
    });

  it("accepts module-only notes but not called or imported vulnerable code", () => {
    expect(binaryReportHasNoCalls(report("note"))).toBe(true);
    expect(binaryReportHasNoCalls(report("error"))).toBe(false);
    expect(binaryReportHasNoCalls(report("warning"))).toBe(false);
    expect(binaryReportHasNoCalls(report())).toBe(false);
  });

  it("rejects missing or malformed scanner evidence", () => {
    expect(() => binaryReportHasNoCalls("{}")).toThrow();
    expect(() => binaryReportHasNoCalls(JSON.stringify({ version: "2.1.0", runs: [] }))).toThrow();
    expect(() => binaryReportHasNoCalls(report("invalid"))).toThrow();
    expect(() => binaryReportHasNoCalls("not-json")).toThrow();
  });

  it("accepts official pinned artifacts and rejects every locally derived image", () => {
    expect(() => assertOfficialImages(IMAGES)).not.toThrow();
    for (const name of IMAGE_NAMES) {
      expect(() => assertOfficialImages({ ...IMAGES, [name]: `freelens-velero-lab/${name}:synthetic` })).toThrow(
        "official upstream repository",
      );
      expect(() => assertOfficialImages({ ...IMAGES, [name]: IMAGES[name].split("@")[0] })).toThrow(
        "immutable release pin",
      );
    }
    expect(() => assertOfficialImages({})).toThrow();
    expect(() => assertOfficialImages({ ...IMAGES, other: IMAGES.node })).toThrow();
  });
});

describe("local setup entrypoint refusal", () => {
  const runner = fileURLToPath(new URL("../e2e/scripts/local-demo.mts", import.meta.url));

  it.each([
    { script: "local-remediation.mts", action: "storage" },
    { script: "local-images.mts", action: "install-scanner" },
    { script: "local-images.mts", action: "install-build-tools" },
  ])("disables retired operations before external commands: $script $action", ({ script, action }) => {
    const home = mkdtempSync(join(tmpdir(), "velero-retired-test-"));

    try {
      const entrypoint = fileURLToPath(new URL(`../e2e/scripts/${script}`, import.meta.url));
      const result = spawnSync(process.execPath, [entrypoint, action], {
        env: { HOME: home, PATH: "" },
        encoding: "utf8",
        timeout: 10_000,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Retired by user directive");
      expect(existsSync(join(home, ".local"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it.each([
    { args: ["cluster", "--context", "kind-kind"] },
    { args: ["cluster"] },
    { args: ["delete", "--context", DEMO_CONTEXT] },
  ])("rejects unsafe arguments before creating state: $args", ({ args }) => {
    const home = mkdtempSync(join(tmpdir(), "velero-cli-test-"));

    try {
      const result = spawnSync(process.execPath, [runner, ...args], {
        env: { HOME: home, PATH: "" },
        encoding: "utf8",
        timeout: 10_000,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Usage:");
      expect(existsSync(join(home, ".local"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("releases its lock when initialization rejects a malformed journal", () => {
    const home = mkdtempSync(join(tmpdir(), "velero-cli-test-"));
    const state = join(home, ".local", "state", DEMO_CLUSTER);

    try {
      mkdirSync(state, { recursive: true });
      writeFileSync(join(state, "ownership.json"), JSON.stringify({ version: 0 }));
      const result = spawnSync(process.execPath, [runner, "cluster", "--context", DEMO_CONTEXT], {
        env: { HOME: home, PATH: "" },
        encoding: "utf8",
        timeout: 10_000,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Invalid ownership journal");
      expect(existsSync(join(state, "run.lock"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
