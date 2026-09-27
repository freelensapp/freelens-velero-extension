import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  fixtureNamespaces,
  LONG_BACKUP_NAME,
  liveBackup,
  liveRestore,
  RESTORE_PHASES,
  readerKubeconfig,
  restrictedFixtures,
  SCALE_BACKUPS,
  scaleFixtures,
  staticFixtures,
  VIEW_READER,
  viewFixtures,
} from "../e2e/scripts/local-fixtures.mts";
import {
  assertEgressRules,
  assertFailedNodeRemoval,
  assertLocalKind,
  assertOwnedNetwork,
  assertOwnedNode,
  assertOwnedResource,
  assertStoppedKind,
  DEMO_CLUSTER,
  DEMO_CONTEXT,
  DEMO_NETWORK,
  type DemoIdentity,
  DOCKER_HOST,
  egressChains,
  egressState,
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
import {
  assertBinary,
  assertIndexPlatforms,
  assertLogWithholds,
  BINARIES,
  binaryTarget,
  binaryUrl,
  childEnvironment,
  dockerSocket,
  engineIndex,
  failureSummary,
  imageArchitecture,
  imagePlatform,
  type NetworkShape,
  networkShape,
  nodeMemory,
  occupiedSubnets,
  platformManifest,
  verifiedPins,
  withhold,
} from "../e2e/scripts/local-platform.mts";
import { assertOfficialImages, IMAGE_NAMES } from "../e2e/scripts/local-security.mts";

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

  it("gives the views their references, a long name, a silent object and a reader of a part", () => {
    const names = fixtureNames(run);
    const resources = viewFixtures("synthetic-owner", run);
    const named = (name: string) => resources.find((resource) => resource.metadata.name === name);
    const role = resources.find((resource) => resource.kind === "Role");

    expect(resources[0]).toMatchObject({ kind: "Namespace", metadata: { name: names.views } });
    expect(
      resources.slice(1).every((resource) => resource.metadata.namespace === names.views && !("data" in resource)),
    ).toBe(true);
    expect(
      resources.every(
        (resource) =>
          resource.metadata.labels?.[OWNER_LABEL] === "synthetic-owner" &&
          resource.metadata.labels?.[FIXTURE_LABEL] === run &&
          resource.metadata.labels?.[FIXTURE_MODE] === "synthetic",
      ),
    ).toBe(true);
    // A reference that leads somewhere, and the ones that lead nowhere.
    expect(named("views-daily-20260901030000")).toMatchObject({
      metadata: { labels: { "velero.io/schedule-name": "views-daily" } },
      spec: { storageLocation: "views-available", volumeSnapshotLocations: ["views-snapshots"] },
      status: { phase: "Completed", warnings: 2, errors: 0 },
    });
    for (const target of ["views-daily", "views-available", "views-snapshots"]) expect(named(target)).toBeDefined();
    expect(named("backup-missing-schedule")?.metadata.labels?.["velero.io/schedule-name"]).toBe("views-removed");
    expect(named("backup-missing-location")?.spec).toMatchObject({ storageLocation: "views-removed" });
    expect(named("views-removed")).toBeUndefined();
    expect(
      resources
        .filter((resource) => resource.kind === "Restore")
        .map((resource) => (resource.spec as { backupName: string }).backupName),
    ).toEqual(["views-daily-20260901030000", "views-daily-20260901030000"]);
    expect(LONG_BACKUP_NAME).toHaveLength(63);
    expect(named(LONG_BACKUP_NAME)).toBeDefined();
    expect(named("backup-unreported")).not.toHaveProperty("status");
    // A name that another installation has too, for an object that is not the same.
    expect(staticFixtures("synthetic-owner", run).map((resource) => resource.metadata.name)).toContain(
      "backup-inprogress",
    );
    expect(named("backup-inprogress")).toMatchObject({
      spec: { storageLocation: "views-available" },
      status: { progress: { itemsBackedUp: 7 } },
    });
    // The reader reads three families in its namespace and nothing else: no restore, no snapshot location,
    // no secret, no write, nothing of the cluster.
    expect(role?.rules).toEqual([
      {
        apiGroups: ["velero.io"],
        resources: ["backups", "schedules", "backupstoragelocations"],
        verbs: ["get", "list", "watch"],
      },
    ]);
    expect(resources.some((resource) => /^Cluster/.test(resource.kind) || resource.kind === "Secret")).toBe(false);
    expect(named(VIEW_READER)).toMatchObject({ automountServiceAccountToken: false });
    expect(() => viewFixtures("", run)).toThrow();
  });

  it("fills the long list with a thousand backups in every phase, none of them of an installation", () => {
    const names = fixtureNames(run);
    const { namespace, backups } = scaleFixtures("synthetic-owner", run);

    expect(namespace.metadata.name).toBe(names.scale);
    expect(backups).toHaveLength(SCALE_BACKUPS);
    expect(new Set(backups.map((backup) => backup.metadata.name)).size).toBe(1000);
    expect(new Set(backups.map((backup) => (backup.status as { phase: string }).phase))).toEqual(
      new Set(BACKUP_PHASES),
    );
    expect(new Set(backups.map((backup) => (backup.status as { startTimestamp?: string }).startTimestamp)).size).toBe(
      // One start for each backup that has one: the ones that are New have none.
      backups.filter((backup) => (backup.status as { phase: string }).phase !== "New").length + 1,
    );
    expect(
      backups.every(
        (backup) =>
          backup.kind === "Backup" &&
          backup.metadata.namespace === names.scale &&
          backup.metadata.labels?.[OWNER_LABEL] === "synthetic-owner" &&
          backup.metadata.labels?.[FIXTURE_LABEL] === run,
      ),
    ).toBe(true);
    expect(fixtureNamespaces(run)).toEqual([names.source, names.restored, names.static, names.views, names.scale]);
  });

  it("gives the reader the kubeconfig of the environment with its own credential and its namespace", () => {
    const config = {
      "current-context": "kind-synthetic",
      contexts: [{ name: "kind-synthetic", context: { cluster: "kind-synthetic", user: "kind-synthetic" } }],
      clusters: [{ name: "kind-synthetic", cluster: { server: "https://127.0.0.1:6443" } }],
      users: [{ name: "kind-synthetic", user: { "client-key-data": "synthetic", "client-certificate-data": "x" } }],
    };
    const token = "t".repeat(120);
    const reader = readerKubeconfig(config, token, "velero-views-a1a2a3a4");

    expect(reader.users).toEqual([{ name: "kind-synthetic", user: { token } }]);
    expect(reader.contexts[0].context).toEqual({
      cluster: "kind-synthetic",
      user: "kind-synthetic",
      namespace: "velero-views-a1a2a3a4",
    });
    expect(reader.clusters).toEqual(config.clusters);
    // The kubeconfig of the environment is left as it was.
    expect(config.users[0].user).toHaveProperty("client-key-data");
    expect(config.contexts[0].context).not.toHaveProperty("namespace");
    expect(() => readerKubeconfig(config, "short", "velero-views-a1a2a3a4")).toThrow();
    expect(() => readerKubeconfig({ ...config, users: [...config.users, ...config.users] }, token, "x")).toThrow();
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

const SHAPES = ["internal", "loopback"] as const;

function readdirNames(directory: string): string[] {
  return readdirSync(directory).sort();
}

function fixture(shape: NetworkShape = "internal") {
  const published = shape === "loopback";
  const identity: DemoIdentity = {
    owner: "synthetic-owner",
    nodeId: "synthetic-node",
    networkId: "synthetic-network",
    kubeconfigHash: "synthetic-hash",
    shape,
  };
  const network: KindNetwork = {
    Id: identity.networkId,
    Labels: { [OWNER_LABEL]: identity.owner },
    Internal: !published,
    Driver: "bridge",
    IPAM: { Config: [{ Subnet: SUBNETS.docker }] },
  };
  const node: KindNode = {
    Id: identity.nodeId,
    State: { Running: true },
    Config: { Labels: { "io.x-k8s.kind.cluster": DEMO_CLUSTER, "io.x-k8s.kind.role": "control-plane" } },
    NetworkSettings: {
      Networks: { [DEMO_NETWORK]: { NetworkID: identity.networkId, IPAddress: "198.18.64.2" } },
      Ports: { "6443/tcp": published ? [{ HostIp: "127.0.0.1", HostPort: "16443" }] : null },
    },
  };
  const config: KindConfig = {
    "current-context": DEMO_CONTEXT,
    contexts: [{ name: DEMO_CONTEXT, context: { cluster: DEMO_CONTEXT, user: DEMO_CONTEXT } }],
    clusters: [
      {
        name: DEMO_CONTEXT,
        cluster: {
          server: published ? "https://127.0.0.1:16443" : "https://198.18.64.2:6443",
          "certificate-authority-data": "synthetic-ca",
        },
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

  it.each(SHAPES)("accepts only the fully bound owned local target on the %s shape", (shape) => {
    const { identity, network, nodes, config } = fixture(shape);

    expect(() => assertLocalKind(identity, nodes, network, config, identity.kubeconfigHash)).not.toThrow();
  });

  it("reads a journal without a shape as the internal one", () => {
    const { identity, network, nodes, config } = fixture("internal");

    delete identity.shape;
    expect(() => assertLocalKind(identity, nodes, network, config, identity.kubeconfigHash)).not.toThrow();
    expect(() =>
      assertLocalKind(identity, nodes, { ...network, Internal: false }, config, identity.kubeconfigHash),
    ).toThrow();
  });

  it("allows an unpublished internal API only at the exact owned node address", () => {
    const { identity, nodes, network, config } = fixture("internal");

    expect(() => assertLocalKind(identity, nodes, network, config, identity.kubeconfigHash)).not.toThrow();
    config.clusters[0].cluster.server = "https://198.18.64.3:6443";
    expect(() => assertLocalKind(identity, nodes, network, config, identity.kubeconfigHash)).toThrow();
    config.clusters[0].cluster.server = "https://198.18.64.2:6443";
    nodes[0].NetworkSettings.Networks[DEMO_NETWORK].IPAddress = "192.0.2.2";
    config.clusters[0].cluster.server = "https://192.0.2.2:6443";
    expect(() => assertLocalKind(identity, nodes, network, config, identity.kubeconfigHash)).toThrow();
  });

  it.each([
    [
      "a port published on the internal shape",
      "internal",
      (value: ReturnType<typeof fixture>) => {
        // The kubeconfig stays right, so that only the published port can be the reason.
        value.nodes[0].NetworkSettings.Ports["6443/tcp"] = [{ HostIp: "127.0.0.1", HostPort: "16443" }];
      },
    ],
    [
      "a network that is not internal on the internal shape",
      "internal",
      (value: ReturnType<typeof fixture>) => {
        value.network.Internal = false;
      },
    ],
    [
      "an internal network on the loopback shape",
      "loopback",
      (value: ReturnType<typeof fixture>) => {
        value.network.Internal = true;
      },
    ],
    [
      "no published API on the loopback shape",
      "loopback",
      (value: ReturnType<typeof fixture>) => {
        value.nodes[0].NetworkSettings.Ports["6443/tcp"] = null;
        value.config.clusters[0].cluster.server = "https://198.18.64.2:6443";
      },
    ],
    [
      "a second published port",
      "loopback",
      (value: ReturnType<typeof fixture>) => {
        value.nodes[0].NetworkSettings.Ports["8333/tcp"] = [{ HostIp: "127.0.0.1", HostPort: "18333" }];
      },
    ],
    [
      "the API published twice",
      "loopback",
      (value: ReturnType<typeof fixture>) => {
        value.nodes[0].NetworkSettings.Ports["6443/tcp"]?.push({ HostIp: "127.0.0.1", HostPort: "26443" });
      },
    ],
    [
      "a wrong loopback port",
      "loopback",
      (value: ReturnType<typeof fixture>) => {
        value.config.clusters[0].cluster.server = "https://127.0.0.1:26443";
      },
    ],
    [
      "an API published on every address",
      "loopback",
      (value: ReturnType<typeof fixture>) => {
        const ports = value.nodes[0].NetworkSettings.Ports["6443/tcp"];
        if (ports) ports[0].HostIp = "0.0.0.0";
      },
    ],
    [
      "the address of the node in the kubeconfig of the loopback shape",
      "loopback",
      (value: ReturnType<typeof fixture>) => {
        value.config.clusters[0].cluster.server = "https://198.18.64.2:6443";
      },
    ],
  ] as const)("rejects %s", (name, shape, mutate) => {
    const value = fixture(shape);
    const reasons: Record<string, string> = {
      "a port published on the internal shape": "The internal shape publishes no port",
      "a network that is not internal on the internal shape": "does not have the shape the journal records",
      "an internal network on the loopback shape": "does not have the shape the journal records",
      "no published API on the loopback shape": "Only the API server may be published, and only on loopback",
      "a second published port": "Only the API server may be published, and only on loopback",
      "the API published twice": "Only the API server may be published, and only on loopback",
      "a wrong loopback port": "Kubeconfig does not address the owned node",
      "an API published on every address": "Only the API server may be published, and only on loopback",
      "the address of the node in the kubeconfig of the loopback shape": "Kubeconfig does not address the owned node",
    };

    expect(reasons[name]).toBeTruthy();
    expect(() =>
      assertLocalKind(value.identity, value.nodes, value.network, value.config, value.identity.kubeconfigHash),
    ).not.toThrow();
    mutate(value);
    expect(() =>
      assertLocalKind(value.identity, value.nodes, value.network, value.config, value.identity.kubeconfigHash),
    ).toThrow(reasons[name]);
  });

  it.each(SHAPES)("removes only the node the journal names, on the %s shape", (shape) => {
    const { identity, nodes, network } = fixture(shape);
    const stopped = [{ ...nodes[0], State: { Running: false } }];

    expect(() => assertOwnedNode(identity, nodes, network)).not.toThrow();
    expect(() => assertOwnedNode(identity, stopped, network)).not.toThrow();
    expect(() => assertOwnedNode({ ...identity, nodeId: "another-node" }, nodes, network)).toThrow(
      "A node exists that the journal does not own",
    );
    expect(() => assertOwnedNode(identity, [...nodes, ...nodes], network)).toThrow(
      "A node exists that the journal does not own",
    );
    expect(() => assertOwnedNode(identity, [], network)).toThrow("A node exists that the journal does not own");
    expect(() => assertOwnedNode({ ...identity, nodeId: "" }, nodes, network)).toThrow("Incomplete node ownership");
    expect(() =>
      assertOwnedNode(identity, [{ ...nodes[0], Config: { Labels: { "io.x-k8s.kind.cluster": "kind" } } }], network),
    ).toThrow("Wrong node identity");
    expect(() => assertOwnedNode(identity, nodes, { ...network, Labels: {} })).toThrow("Wrong network owner");
    expect(() => assertOwnedNode(identity, nodes, { ...network, Internal: shape !== "internal" })).toThrow(
      "does not have the shape the journal records",
    );
    const second = structuredClone(nodes);

    second[0].NetworkSettings.Networks.kind = { NetworkID: "another-network", IPAddress: "172.18.0.2" };
    expect(() => assertOwnedNode(identity, second, network)).toThrow("The node is not on the owned network alone");
    const moved = structuredClone(nodes);

    moved[0].NetworkSettings.Networks[DEMO_NETWORK].NetworkID = "another-network";
    expect(() => assertOwnedNode(identity, moved, network)).toThrow("The node is not on the owned network alone");
  });

  describe.each(SHAPES)("on the %s shape", (shape) => {
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
      const value = fixture(shape);

      mutate(value);
      expect(() =>
        assertLocalKind(value.identity, value.nodes, value.network, value.config, value.identity.kubeconfigHash),
      ).toThrow();
    });
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

  it("passes to a child process only what the allowlist names", () => {
    const original = {
      PATH: "/synthetic/bin",
      LANG: "en_US.UTF-8",
      HOME: "/synthetic-home",
      GITHUB_TOKEN: "synthetic-token",
      NPM_TOKEN: "synthetic-token",
      SSH_AUTH_SOCK: "/synthetic/agent.sock",
      SOME_FUTURE_PROVIDER_KEY: "synthetic-key",
    };
    const environment = localEnvironment(original, "/synthetic-private/kubeconfig", "unix:///synthetic/docker.sock");

    expect(environment.PATH).toBe("/synthetic/bin");
    expect(environment.LANG).toBe("en_US.UTF-8");
    expect(environment.DOCKER_HOST).toBe("unix:///synthetic/docker.sock");
    for (const key of ["HOME", "GITHUB_TOKEN", "NPM_TOKEN", "SSH_AUTH_SOCK", "SOME_FUTURE_PROVIDER_KEY"])
      expect(environment[key]).toBeUndefined();
    expect(childEnvironment({ PATH: "/caller" }, { PATH: "/own" }).PATH).toBe("/own");
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

describe("platform of the test environment", () => {
  it("takes the platform of the images from the Docker daemon", () => {
    expect(imagePlatform({ OSType: "linux", Architecture: "x86_64" })).toBe("linux/amd64");
    expect(imagePlatform({ OSType: "linux", Architecture: "aarch64" })).toBe("linux/arm64");
    expect(imagePlatform({ OSType: "linux", Architecture: "arm64" })).toBe("linux/arm64");
    expect(imageArchitecture("linux/arm64")).toBe("arm64");
    expect(imageArchitecture("linux/amd64")).toBe("amd64");
    expect(() => imagePlatform({ OSType: "linux", Architecture: "riscv64" })).toThrow("Unsupported");
    expect(() => imagePlatform({ OSType: "windows", Architecture: "x86_64" })).toThrow();
  });

  it("accepts a pin only when its index serves both platforms", () => {
    const digest = (character: string) => `sha256:${character.repeat(64)}`;
    const index = {
      manifests: [
        { digest: digest("a"), platform: { os: "linux", architecture: "amd64" } },
        { digest: digest("b"), platform: { os: "linux", architecture: "arm64" } },
        { digest: digest("c"), platform: { os: "linux", architecture: "arm" } },
        { digest: digest("d"), platform: { os: "unknown", architecture: "unknown" } },
      ],
    };

    expect(() => assertIndexPlatforms("storage", index)).not.toThrow();
    expect(platformManifest("storage", index, "linux/arm64")).toBe(digest("b"));
    expect(() => assertIndexPlatforms("storage", { manifests: index.manifests.slice(0, 1) })).toThrow(
      "The pin of the storage image is not an index with linux/arm64",
    );
    expect(() => assertIndexPlatforms("plugin", { manifests: index.manifests.slice(1) })).toThrow(
      "The pin of the plugin image is not an index with linux/amd64",
    );
    // A single-platform manifest has no list, and two entries for one platform do not say which to trust.
    expect(() => assertIndexPlatforms("velero", {})).toThrow("velero");
    expect(() =>
      platformManifest("velero", { manifests: [index.manifests[0], index.manifests[0]] }, "linux/amd64"),
    ).toThrow();
    expect(() =>
      platformManifest(
        "velero",
        { manifests: [{ digest: "latest", platform: { os: "linux", architecture: "amd64" } }] },
        "linux/amd64",
      ),
    ).toThrow();
  });

  it("reads the index from the engine when it holds it, and remembers the pins it has read", () => {
    const digest = (character: string) => `sha256:${character.repeat(64)}`;
    const held = {
      Descriptor: { digest: digest("0") },
      Manifests: [
        { Kind: "image", Descriptor: { digest: digest("a"), platform: { os: "linux", architecture: "amd64" } } },
        { Kind: "image", Descriptor: { digest: digest("b"), platform: { os: "linux", architecture: "arm64" } } },
        {
          Kind: "attestation",
          Descriptor: { digest: digest("c"), platform: { os: "unknown", architecture: "unknown" } },
        },
      ],
    };
    const index = engineIndex(digest("0"), held);

    expect(index?.manifests?.map((manifest) => manifest.digest)).toEqual([digest("a"), digest("b")]);
    expect(() => assertIndexPlatforms("storage", index ?? {})).not.toThrow();
    // Another image under the name, the classic store that keeps no index, an engine that did not answer.
    expect(engineIndex(digest("1"), held)).toBeUndefined();
    expect(engineIndex(digest("0"), { Descriptor: held.Descriptor })).toBeUndefined();
    expect(engineIndex(digest("0"), { Descriptor: held.Descriptor, Manifests: [] })).toBeUndefined();
    expect(engineIndex(digest("0"), undefined)).toBeUndefined();
    // An index the engine holds without one of the two platforms is refused like one of the registry.
    expect(() =>
      assertIndexPlatforms(
        "storage",
        engineIndex(digest("0"), { ...held, Manifests: held.Manifests.slice(0, 1) }) ?? {},
      ),
    ).toThrow("The pin of the storage image is not an index with linux/arm64");
    expect(verifiedPins(JSON.stringify([digest("0"), "latest", 7, digest("1")]))).toEqual([digest("0"), digest("1")]);
    expect(verifiedPins(undefined)).toEqual([]);
    expect(verifiedPins("{")).toEqual([]);
    expect(verifiedPins('{"pins":[]}')).toEqual([]);
  });

  it("finds a generated secret or a token in the log of the operations", () => {
    const secret = "5".repeat(64);
    const token = ["eyJhbGciOiJSUzI1NiJ9", "eyJpc3MiOiJzeW50aGV0aWMifQ", "c2lnbmF0dXJl"].join(".");

    expect(() => assertLogWithholds("kubectl create token\noutput withheld\n", [secret])).not.toThrow();
    expect(() => assertLogWithholds(`kubectl get\n{"secretKey":"${secret}"}\n`, [secret])).toThrow(
      "holds a generated secret",
    );
    expect(() => assertLogWithholds(`kubectl create token\n${token}\n`, [secret])).toThrow("holds a token");
    expect(() => assertLogWithholds("", ["short"])).toThrow("too short");
    // The body of a Secret is the encoded text of a file, and the secret starts anywhere inside it.
    for (const before of ["", "k", "ke", "key", "[default]\naws_secret_access_key="]) {
      const body = Buffer.from(`${before}${secret}\n`).toString("base64");

      expect(() => assertLogWithholds(`kubectl get\n{"data":{"cloud":"${body}"}}\n`, [secret])).toThrow(
        "holds an encoded generated secret",
      );
    }
    expect(() =>
      assertLogWithholds(`kubectl get\n${Buffer.from("6".repeat(64)).toString("base64")}\n`, [secret]),
    ).not.toThrow();
  });

  it("says why a command failed without its traces and without anything that could be a secret", () => {
    const key = "k".repeat(48);
    const output = [
      "Creating cluster ...",
      'I0927 15:14:20.264560     198 round_trippers.go:632] "Response" verb="POST" status="" error: refused',
      `ERROR: failed to create cluster: failed to init node with kubeadm: exit status 1 ${key}`,
      "error: error execution phase wait-control-plane: could not bootstrap the admin user",
      "error: error execution phase wait-control-plane: could not bootstrap the admin user",
      "k8s.io/kubernetes/cmd/kubeadm/app.Run failed",
      "\tgithub.com/spf13/cobra@v1.9.1/command.go:1148",
      "[ERROR Port-6443]: Port 6443 is in use",
      "the node became ready",
    ].join("\n");

    expect(failureSummary(output)).toEqual([
      "ERROR: failed to create cluster: failed to init node with kubeadm: exit status 1 withheld",
      "error: error execution phase wait-control-plane: could not bootstrap the admin user",
      "[ERROR Port-6443]: Port 6443 is in use",
    ]);
    expect(failureSummary("")).toEqual([]);
    expect(
      failureSummary(Array.from({ length: 40 }, (_value, index) => `error: reason ${index}`).join("\n")),
    ).toHaveLength(12);
    expect(failureSummary(`error: ${"x".repeat(900)} y`)[0].length).toBeLessThanOrEqual(300);
  });

  it("records a Secret without its body and a kubeconfig without its credentials", () => {
    const secret = "7".repeat(64);
    const body = Buffer.from(`aws_secret_access_key=${secret}\n`).toString("base64");
    const list = {
      kind: "List",
      items: [
        {
          kind: "Secret",
          metadata: { name: "cloud-credentials" },
          data: { cloud: body },
          stringData: { cloud: secret },
        },
        { kind: "ConfigMap", metadata: { name: "kept" }, data: { payload: "synthetic" } },
        {
          kind: "Deployment",
          metadata: { annotations: { "kubectl.kubernetes.io/last-applied-configuration": `{"data":"${body}"}` } },
        },
      ],
    };
    const recorded = withhold(JSON.stringify(list));

    expect(recorded).not.toContain(body);
    expect(recorded).not.toContain(secret);
    expect(recorded).toContain("cloud-credentials");
    expect(JSON.parse(recorded).items[1].data.payload).toBe("synthetic");
    expect(() => assertLogWithholds(recorded, [secret])).not.toThrow();
    expect(() => assertLogWithholds(JSON.stringify(list), [secret])).toThrow();
    const { config } = fixture("loopback");
    const kubeconfig = withhold(JSON.stringify(config));

    expect(kubeconfig).not.toContain("synthetic-key");
    expect(kubeconfig).not.toContain("synthetic-cert");
    expect(kubeconfig).toContain("https://127.0.0.1:16443");
    // What is not a document is recorded as it is.
    expect(withhold("deployment.apps/seaweedfs condition met\n")).toBe("deployment.apps/seaweedfs condition met\n");
    expect(withhold("{ not a document")).toBe("{ not a document");
  });

  it("holds the node back with the expected rules, first in their parents", () => {
    const address = "198.18.64.2";
    const chains = egressChains(address);
    const listing = [
      "-P INPUT ACCEPT",
      "-P FORWARD ACCEPT",
      "-P OUTPUT ACCEPT",
      ...chains.map(({ chain }) => `-N ${chain}`),
      ...chains.map(({ parent, chain }) => `-A ${parent} -j ${chain}`),
      "-A INPUT -j KUBE-FIREWALL",
      '-A FORWARD -m comment --comment "kubernetes forwarding rules" -j KUBE-FORWARD',
      "-A OUTPUT -j KUBE-FIREWALL",
      ...chains.flatMap(({ chain, rules }) => rules.map((rule) => `-A ${chain} ${rule.join(" ")}`)),
    ];

    expect(chains.map(({ parent, chain }) => `${parent} ${chain}`)).toEqual([
      "OUTPUT FV_DEMO_OUT",
      "FORWARD FV_DEMO_FWD",
      "INPUT FV_DEMO_IN",
    ]);
    // As the node lists them: the listing of a real node was the model of these lines.
    expect(listing).toContain("-A FV_DEMO_OUT -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN");
    expect(listing).toContain(
      "-A FV_DEMO_FWD -d 198.19.0.0/18 -p tcp -m tcp --dport 18333 -j REJECT --reject-with icmp-port-unreachable",
    );
    expect(listing).toContain("-A FV_DEMO_IN -d 127.0.0.11/32 -j REJECT --reject-with icmp-port-unreachable");
    expect(listing).toContain("-A FV_DEMO_OUT -d 198.18.64.2/32 -j RETURN");
    expect(listing.at(-1)).toBe("-A FV_DEMO_IN -d 127.0.0.11/32 -j REJECT --reject-with icmp-port-unreachable");
    expect(() => assertEgressRules(listing.join("\n"), address)).not.toThrow();
    // The resolver of Docker is refused before the loopback addresses are let through.
    const leaving = chains[0].rules.map((rule) => rule.join(" "));

    expect(leaving.indexOf("-d 127.0.0.11/32 -j REJECT --reject-with icmp-port-unreachable")).toBeLessThan(
      leaving.indexOf("-d 127.0.0.0/8 -j RETURN"),
    );
    expect(leaving.at(-1)).toBe("-j REJECT --reject-with icmp-net-unreachable");
    const without = (line: string) => listing.filter((other) => other !== line).join("\n");

    expect(egressState(without("-N FV_DEMO_OUT"), chains[0]).rules).toBe("absent");
    expect(egressState(without("-A FV_DEMO_OUT -j REJECT --reject-with icmp-net-unreachable"), chains[0]).rules).toBe(
      "different",
    );
    expect(() =>
      assertEgressRules(without("-A FV_DEMO_OUT -j REJECT --reject-with icmp-net-unreachable"), address),
    ).toThrow("The rules of FV_DEMO_OUT are not the expected ones");
    expect(() =>
      assertEgressRules(
        without("-A FV_DEMO_IN -d 127.0.0.11/32 -j REJECT --reject-with icmp-port-unreachable"),
        address,
      ),
    ).toThrow("The rules of FV_DEMO_IN are not the expected ones");
    expect(egressState(without("-A OUTPUT -j FV_DEMO_OUT"), chains[0]).jump).toBe(0);
    // The rules of the services of the node in front of ours, as after a restart.
    const behind = [
      ...listing.filter((line) => line !== "-A OUTPUT -j FV_DEMO_OUT" && line !== "-A OUTPUT -j KUBE-FIREWALL"),
      "-A OUTPUT -j KUBE-FIREWALL",
      "-A OUTPUT -j FV_DEMO_OUT",
    ].join("\n");

    expect(egressState(behind, chains[0])).toEqual({ rules: "complete", jump: 2 });
    expect(() => assertEgressRules(behind, address)).toThrow("FV_DEMO_OUT is not the first rule of OUTPUT");
    // Rules in another order, or for another node, are not the expected ones.
    const swapped = listing.map((line) =>
      line === "-A FV_DEMO_OUT -d 198.18.64.2/32 -j RETURN" ? "-A FV_DEMO_OUT -d 198.18.64.3/32 -j RETURN" : line,
    );

    expect(egressState(swapped.join("\n"), chains[0]).rules).toBe("different");
    expect(() => egressState([...listing, "-A OUTPUT -j FV_DEMO_OUT"].join("\n"), chains[0])).toThrow("is repeated");
    expect(() => egressChains("192.0.2.2")).toThrow("Invalid owned node address");
  });

  it("uploads nothing from the hosted run and always takes the environment down", () => {
    const workflow = readFileSync(new URL("../.github/workflows/e2e-tests.yaml", import.meta.url), "utf8");

    expect(workflow).not.toMatch(/upload-artifact|actions\/cache\/save|\.local\/state/);
    expect(workflow).toMatch(/if: always\(\)\n\s+run: pnpm --color=always e2e:cluster:down/);
    expect(workflow).toContain("runs-on: ubuntu-24.04-arm");
  });

  it("uploads from the run of the views their screenshots and reports, and nothing of the state", () => {
    // What the workflow does, without what it says of itself in its comments.
    const workflow = readFileSync(new URL("../.github/workflows/views-tests.yaml", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    const uploads = [...workflow.matchAll(/uses: actions\/upload-artifact@[^\n]+\n\s+with:\n((?:\s{10,}[^\n]+\n)+)/g)];
    const saved = [...workflow.matchAll(/uses: actions\/cache\/save@[^\n]+\n\s+with:\n\s+path: ([^\n]+)/g)];

    expect(uploads).toHaveLength(1);
    expect(uploads[0][1]).toMatch(/\n?\s+path: e2e-artifacts\/\n/);
    expect(uploads[0][1].match(/path:/g)).toHaveLength(1);
    // The only thing kept from a run is the application that was built, which holds nothing of a run.
    expect(saved.map((match) => match[1])).toEqual(["freelens/freelens/dist"]);
    expect(workflow).not.toMatch(/\.local\/state|kubeconfig|credentials|operations\.log/);
    expect(workflow).toMatch(/if: always\(\)\n\s+run: node e2e\/scripts\/local-demo\.mts down --context/);
    expect(workflow).toContain("runs-on: ubuntu-24.04-arm");
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
  });

  it("keeps the internal network wherever the host reaches the address of the node", () => {
    expect(networkShape("linux", { OperatingSystem: "Ubuntu 24.04.3 LTS" })).toBe("internal");
    expect(networkShape("linux", {})).toBe("internal");
    expect(networkShape("linux", { OperatingSystem: "Docker Desktop" })).toBe("loopback");
    expect(networkShape("darwin", { OperatingSystem: "Docker Desktop" })).toBe("loopback");
    expect(networkShape("darwin", { OperatingSystem: "Alpine Linux" })).toBe("loopback");
  });

  it("limits the node to the memory the daemon has and asks for enough of it", () => {
    const gibibyte = 1024 ** 3;

    expect(nodeMemory({ NCPU: 4, MemTotal: 16 * gibibyte })).toBe(8192);
    expect(nodeMemory({ NCPU: 12, MemTotal: 8 * gibibyte - 300 * 1024 ** 2 })).toBe(7892);
    expect(() => nodeMemory({ NCPU: 4, MemTotal: 4 * gibibyte })).toThrow("6 GiB");
    expect(() => nodeMemory({ NCPU: 2, MemTotal: 16 * gibibyte })).toThrow("processors");
    expect(() => nodeMemory({ NCPU: 4, MemTotal: 0 })).toThrow();
  });

  it("names the official release of each binary for each host", () => {
    expect(binaryTarget("darwin", "x64")).toBe("darwin-amd64");
    expect(binaryTarget("linux", "arm64")).toBe("linux-arm64");
    expect(() => binaryTarget("win32", "x64")).toThrow("Unsupported host system");
    expect(() => binaryTarget("linux", "ia32")).toThrow("Unsupported host architecture");
    expect(binaryUrl("kind", "linux-arm64")).toBe(
      `https://github.com/kubernetes-sigs/kind/releases/download/v${BINARIES.kind.version}/kind-linux-arm64`,
    );
    expect(binaryUrl("kubectl", "darwin-amd64")).toBe(
      `https://dl.k8s.io/release/v${BINARIES.kubectl.version}/bin/darwin/amd64/kubectl`,
    );
    for (const binary of Object.values(BINARIES)) {
      expect(Object.keys(binary.checksums).sort()).toEqual([
        "darwin-amd64",
        "darwin-arm64",
        "linux-amd64",
        "linux-arm64",
      ]);
      expect(new Set(Object.values(binary.checksums)).size).toBe(4);
      for (const checksum of Object.values(binary.checksums)) expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("refuses a download that does not match its pinned checksum", () => {
    expect(() => assertBinary("kind", "linux-amd64", new TextEncoder().encode("not the release"))).toThrow(
      "does not match its pinned checksum",
    );
    expect(() => assertBinary("kubectl", "darwin-arm64", new Uint8Array())).toThrow();
  });

  it("uses a local Docker socket and nothing else", () => {
    const sockets = new Set(["/synthetic/run/docker.sock"]);

    expect(dockerSocket(["/var/run/docker.sock", "/synthetic/run/docker.sock"], (path) => sockets.has(path))).toBe(
      "unix:///synthetic/run/docker.sock",
    );
    expect(() => dockerSocket(["/var/run/docker.sock"], () => false)).toThrow("No local Docker socket");
    expect(() => dockerSocket(["relative/docker.sock"], () => true)).toThrow();
  });

  it("compares the subnets with the Docker networks, and with the routes where the host lists them", () => {
    const networks = [
      { Id: "owned", IPAM: { Config: [{ Subnet: SUBNETS.docker }] } },
      { Id: "other", IPAM: { Config: [{ Subnet: "198.18.64.0/26" }, { Subnet: "fd00::/64" }] } },
      { Id: "empty", IPAM: { Config: null } },
    ];
    const owned = { networkId: "owned", bridge: "br-synthetic" };
    const routes = [
      { dst: "default", dev: "eth0" },
      { dst: "198.19.0.0/24", dev: "eth1" },
      { dst: SUBNETS.docker, dev: "br-synthetic" },
    ];

    expect(occupiedSubnets(networks, undefined, owned)).toEqual(["198.18.64.0/26"]);
    expect(occupiedSubnets(networks, routes, owned)).toEqual(["198.19.0.0/24", "198.18.64.0/26"]);
    expect(occupiedSubnets(networks, routes, { networkId: "", bridge: "br-synthetic" })).toEqual([
      "198.19.0.0/24",
      SUBNETS.docker,
      SUBNETS.docker,
      "198.18.64.0/26",
    ]);
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

describe("official image pins", () => {
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

  it("refuses an action the image helper does not have before external commands", () => {
    const home = mkdtempSync(join(tmpdir(), "velero-images-test-"));

    try {
      const entrypoint = fileURLToPath(new URL("../e2e/scripts/local-images.mts", import.meta.url));
      const result = spawnSync(process.execPath, [entrypoint, "install-scanner"], {
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

  // A home with a journal of an earlier run, a default kubeconfig and a Docker that answers from files.
  function machine(
    shape: NetworkShape,
    docker: { nodes: string[]; networks: string[]; onStop?: (kubeconfig: string) => string },
    recorded: { nodeId?: string; networkId?: string } = {},
  ) {
    const home = mkdtempSync(join(realpathSync(tmpdir()), "velero-cli-test-"));
    const state = join(home, ".local", "state", DEMO_CLUSTER);
    const tools = join(home, "tools");
    const kubeconfig = join(home, ".kube", "config");
    const { identity, network, nodes, config } = fixture(shape);

    for (const directory of [join(state, "bin"), join(tools, "nodes"), join(tools, "networks"), join(home, ".kube")])
      mkdirSync(directory, { recursive: true });
    writeFileSync(kubeconfig, "apiVersion: v1\nkind: Config\n");
    writeFileSync(join(state, "kubeconfig"), JSON.stringify(config));
    for (const name of docker.nodes)
      writeFileSync(join(tools, "nodes", `${name}.json`), JSON.stringify({ ...nodes[0], Id: name }));
    for (const name of docker.networks)
      writeFileSync(
        join(tools, "networks", `${name}.json`),
        JSON.stringify({ ...network, Id: name, Labels: { [OWNER_LABEL]: "00000000-0000-4000-8000-000000000000" } }),
      );
    // It lists, inspects and removes what its two directories hold, and records what it was asked to remove.
    writeFileSync(
      join(tools, "docker"),
      [
        "#!/bin/sh",
        `nodes='${join(tools, "nodes")}'`,
        `networks='${join(tools, "networks")}'`,
        'list() { for file in "$1"/*.json; do [ -e "$file" ] && /usr/bin/basename "$file" .json; done; }',
        'show() { directory="$1"; shift; printf "["; separator=""; for name in "$@"; do printf "%s" "$separator"; /bin/cat "$directory/$name.json"; separator=","; done; printf "]"; }',
        'case "$*" in',
        '  "ps -aq --filter label=io.x-k8s.kind.cluster="*) list "$nodes" ;;',
        '  "network ls "*) list "$networks" ;;',
        '  "network inspect "*) show "$networks" synthetic-network ;;',
        '  "inspect "*) shift; show "$nodes" "$@" ;;',
        `  "stop "*) ${docker.onStop?.(kubeconfig) ?? ":"} ;;`,
        `  "rm --force --volumes "*) echo "$*" >> '${join(tools, "removed")}'; /bin/rm -f "$nodes/$4.json" ;;`,
        `  "network rm "*) echo "$*" >> '${join(tools, "removed")}'; /bin/rm -f "$networks/$3.json" ;;`,
        "esac",
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    writeFileSync(join(state, "bin", "kubectl"), `#!/bin/sh\n/bin/cat '${join(state, "kubeconfig")}'\n`, {
      mode: 0o755,
    });
    writeFileSync(join(state, "bin", "kind"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    writeFileSync(
      join(state, "ownership.json"),
      JSON.stringify({
        version: 1,
        owner: "00000000-0000-4000-8000-000000000000",
        nodeId: recorded.nodeId ?? identity.nodeId,
        networkId: recorded.networkId ?? identity.networkId,
        kubeconfigHash: createHash("sha256")
          .update(readFileSync(join(state, "kubeconfig")))
          .digest("hex"),
        shape,
        // What a journal of the foundation stored once, from a file the user has changed since.
        defaultKubeconfigHash: "0".repeat(64),
        resources: [],
        phase: "verified",
      }),
    );
    const run = (action: string) =>
      spawnSync(process.execPath, [runner, action, "--context", DEMO_CONTEXT], {
        env: { HOME: home, PATH: tools },
        encoding: "utf8",
        timeout: 20_000,
      });
    const removed = () => (existsSync(join(tools, "removed")) ? readFileSync(join(tools, "removed"), "utf8") : "");

    return { home, state, kubeconfig, run, removed };
  }

  it.each(SHAPES)(
    "compares the default kubeconfig within one run only, on the %s shape",
    (shape) => {
      const { home, state, kubeconfig, run } = machine(shape, {
        nodes: ["synthetic-node"],
        networks: ["synthetic-network"],
      });

      try {
        const first = run("stop");

        expect(first.stderr).not.toContain("changed");
        expect(first.stdout).toContain("PASS: stopped only the owned demo node");
        expect(first.status).toBe(0);
        // Between two runs the file is of the user, who may change it.
        writeFileSync(kubeconfig, "apiVersion: v1\nkind: Config\ncurrent-context: another\n");
        const second = run("stop");

        expect(second.stdout).toContain("PASS: stopped only the owned demo node");
        expect(second.status).toBe(0);
        expect(readFileSync(kubeconfig, "utf8")).toBe("apiVersion: v1\nkind: Config\ncurrent-context: another\n");
        expect(JSON.parse(readFileSync(join(state, "ownership.json"), "utf8")).phase).toBe("stopped");
        expect(existsSync(join(state, "run.lock"))).toBe(false);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it("stops when the default kubeconfig changes during a run", () => {
    const { home, run } = machine("loopback", {
      nodes: ["synthetic-node"],
      networks: ["synthetic-network"],
      // A command of the environment that writes where none of them may.
      onStop: (kubeconfig) => `echo '# changed' >> '${kubeconfig}'`,
    });

    try {
      const result = run("stop");

      expect(result.stderr).toContain("The default kubeconfig changed during this run");
      expect(result.status).toBe(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);

  it.each(SHAPES)(
    "takes down by identifier what the journal owns, on the %s shape",
    (shape) => {
      const { home, state, kubeconfig, run, removed } = machine(shape, {
        nodes: ["synthetic-node"],
        networks: ["synthetic-network"],
      });

      try {
        writeFileSync(join(state, "pins.json"), "[]");
        writeFileSync(join(state, "credentials.json"), "{}");
        const result = run("down");

        expect(result.stdout).toContain("PASS: removed the owned node, network and private state");
        expect(result.status).toBe(0);
        expect(removed()).toBe("rm --force --volumes synthetic-node\nnetwork rm synthetic-network\n");
        // The tools and the pins that were read stay: neither is of one environment.
        expect(readdirNames(state)).toEqual(["bin", "pins.json"]);
        expect(readFileSync(kubeconfig, "utf8")).toBe("apiVersion: v1\nkind: Config\n");
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it("finishes a removal that an earlier run left halfway", () => {
    // Docker has neither the node nor the network the journal names.
    const { home, state, run, removed } = machine("loopback", { nodes: [], networks: [] });

    try {
      const result = run("down");

      expect(result.stdout).toContain("PASS: removed the owned node, network and private state");
      expect(result.status).toBe(0);
      expect(removed()).toBe("");
      expect(readdirNames(state)).toEqual(["bin"]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);

  it.each([
    {
      name: "a node with the name of the cluster",
      docker: { nodes: ["another-node"], networks: ["synthetic-network"] },
      reason: "A node exists that the journal does not own",
    },
    {
      name: "a second node beside the owned one",
      docker: { nodes: ["synthetic-node", "another-node"], networks: ["synthetic-network"] },
      reason: "A node exists that the journal does not own",
    },
    {
      name: "a network with the name of the environment",
      docker: { nodes: [], networks: ["another-network"] },
      reason: "A network exists that the journal does not own",
    },
    {
      name: "a node while the journal names none",
      docker: { nodes: ["another-node"], networks: ["synthetic-network"] },
      recorded: { nodeId: "" },
      reason: "A node exists that the journal does not own",
    },
    {
      name: "a network while the journal names none",
      docker: { nodes: [], networks: ["another-network"] },
      recorded: { nodeId: "", networkId: "" },
      reason: "A network exists that the journal does not own",
    },
  ])(
    "removes nothing when Docker has $name that the journal does not own",
    ({ docker, recorded, reason }) => {
      const { home, state, run, removed } = machine("internal", docker, recorded);

      try {
        const result = run("down");

        expect(result.stderr).toContain(reason);
        expect(result.status).toBe(1);
        expect(removed()).toBe("");
        expect(existsSync(join(state, "ownership.json"))).toBe(true);
        expect(existsSync(join(state, "run.lock"))).toBe(false);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it("releases its lock when initialization rejects a malformed journal", () => {
    // The temporary directory can sit behind a symlink, which the runner refuses for its state.
    const home = mkdtempSync(join(realpathSync(tmpdir()), "velero-cli-test-"));
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
