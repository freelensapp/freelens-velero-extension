import { isAbsolute } from "node:path";
import { DEMO_NAMESPACE, OWNER_LABEL, requireCondition, SUBNETS } from "./local-kind.mts";

export const IMAGES = {
  node: "docker.io/kindest/node:v1.34.11@sha256:44e222ee2132dab25ff87301682f89eb82c7880ea3a1bf543bfe9708fd08d67d",
  velero: "docker.io/velero/velero:v1.18.2@sha256:37396519f399536e5f01427d723565ae69294ec3fb5625cf1c87c09eaa9de16b",
  plugin:
    "docker.io/velero/velero-plugin-for-aws:v1.14.2@sha256:0751144c1c8e52d52c48717fbd13ad5a3061e612ae4d7ad744a946cd5b139d1a",
  storage: "docker.io/chrislusf/seaweedfs:4.47@sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882",
} as const;
export const BUCKET = "velero-demo";
export const STORAGE_ENDPOINT = `http://seaweedfs.${DEMO_NAMESPACE}.svc.cluster.local:8333`;
export const DATA_DIRECTORY = "/var/local/freelens-velero-dev/seaweedfs";
export const KIND_HOSTS =
  "127.0.0.1 localhost\n::1 localhost ip6-localhost\n198.18.64.1 host.docker.internal\n198.18.64.2 freelens-velero-dev-control-plane\n";

export function preloadedImage(reference: string): string {
  requireCondition(
    Object.values(IMAGES).some((image) => image === reference),
    "Only an exact official image pin can be preloaded",
  );
  return reference.split("@")[0];
}

export interface Credentials {
  accessKey: string;
  secretKey: string;
}

export interface KubeResource {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    uid?: string;
    labels?: Record<string, string>;
    resourceVersion?: string;
  };
  [key: string]: unknown;
}

export function prepareVeleroResources(owner: string, generated: { items: KubeResource[] }): KubeResource[] {
  requireCondition(
    owner && Array.isArray(generated.items) && generated.items.length > 0,
    "Official Velero installer output is required",
  );
  const resources = structuredClone(generated.items);
  const allowed = new Set([
    "Namespace",
    "CustomResourceDefinition",
    "ServiceAccount",
    "Secret",
    "ClusterRole",
    "ClusterRoleBinding",
    "Deployment",
    "DaemonSet",
    "BackupStorageLocation",
  ]);

  for (const resource of resources) {
    requireCondition(allowed.has(resource.kind) && resource.metadata?.name, "Unexpected installer resource kind");
    requireCondition(
      !resource.metadata.namespace || resource.metadata.namespace === DEMO_NAMESPACE,
      "Installer resource targets another namespace",
    );
    resource.metadata.labels = { ...resource.metadata.labels, [OWNER_LABEL]: owner };
    if (resource.kind === "Namespace")
      requireCondition(resource.metadata.name === DEMO_NAMESPACE, "Installer namespace mismatch");
    if (resource.kind === "Deployment" || resource.kind === "DaemonSet") {
      const spec = resource.spec as {
        template: {
          metadata: { labels?: Record<string, string> };
          spec: {
            containers: {
              image: string;
              imagePullPolicy?: string;
              env?: { name: string; value?: string; valueFrom?: unknown }[];
            }[];
            initContainers?: { image: string; imagePullPolicy?: string }[];
          };
        };
      };

      spec.template.metadata.labels = { ...spec.template.metadata.labels, [OWNER_LABEL]: owner };
      for (const container of [...spec.template.spec.containers, ...(spec.template.spec.initContainers ?? [])]) {
        requireCondition(
          [preloadedImage(IMAGES.velero), preloadedImage(IMAGES.plugin)].includes(container.image),
          "Installer selected an unexpected image",
        );
        container.imagePullPolicy = "Never";
      }
      for (const container of spec.template.spec.containers) {
        container.env = (container.env ?? []).filter(
          (item) => !["AWS_EC2_METADATA_DISABLED", "AWS_CONFIG_FILE"].includes(item.name),
        );
        container.env.push(
          { name: "AWS_EC2_METADATA_DISABLED", value: "true" },
          { name: "AWS_CONFIG_FILE", value: "/dev/null" },
        );
      }
    }
    if (resource.kind === "BackupStorageLocation") {
      const spec = resource.spec as {
        provider: string;
        objectStorage: { bucket: string };
        config: Record<string, string>;
      };

      requireCondition(
        spec.provider === "aws" &&
          spec.objectStorage.bucket === BUCKET &&
          spec.config.s3Url === STORAGE_ENDPOINT &&
          spec.config.region === "us-east-1" &&
          spec.config.s3ForcePathStyle === "true",
        "Storage location must use only the explicit local S3 endpoint",
      );
    }
  }
  return resources;
}

export function kindConfiguration(hostsFile: string) {
  requireCondition(isAbsolute(hostsFile), "An explicit private hosts file is required");
  return {
    kind: "Cluster",
    apiVersion: "kind.x-k8s.io/v1alpha4",
    networking: {
      ipFamily: "ipv4",
      apiServerAddress: "127.0.0.1",
      podSubnet: SUBNETS.pods,
      serviceSubnet: SUBNETS.services,
    },
    nodes: [
      {
        role: "control-plane",
        image: IMAGES.node,
        extraMounts: [{ hostPath: hostsFile, containerPath: "/etc/hosts", readOnly: false }],
      },
    ],
  };
}

export function storageConfiguration(admin: Credentials, velero: Credentials) {
  for (const credential of [admin, velero]) {
    requireCondition(
      /^[a-zA-Z0-9]{20,64}$/.test(credential.accessKey) && /^[a-zA-Z0-9]{32,128}$/.test(credential.secretKey),
      "Generated storage credentials are required",
    );
  }
  requireCondition(
    admin.accessKey !== velero.accessKey && admin.secretKey !== velero.secretKey,
    "Bootstrap and Velero identities must differ",
  );

  return {
    identities: [
      { name: "bootstrap", credentials: [admin], actions: ["Admin", "Read", "Write", "List", "Tagging"] },
      {
        name: "velero",
        credentials: [velero],
        actions: [`Read:${BUCKET}`, `Write:${BUCKET}`, `List:${BUCKET}`, `Tagging:${BUCKET}`],
      },
    ],
  };
}

export function storageManifests(owner: string, admin: Credentials, velero: Credentials): KubeResource[] {
  requireCondition(owner, "Ownership is required");
  const labels = { [OWNER_LABEL]: owner, "app.kubernetes.io/name": "velero-demo-storage" };
  const metadata = (name: string) => ({ name, namespace: DEMO_NAMESPACE, labels });

  return [
    { apiVersion: "v1", kind: "Namespace", metadata: { name: DEMO_NAMESPACE, labels: { [OWNER_LABEL]: owner } } },
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: metadata("seaweedfs-auth"),
      type: "Opaque",
      stringData: { "s3.json": JSON.stringify(storageConfiguration(admin, velero)) },
    },
    {
      apiVersion: "v1",
      kind: "PersistentVolume",
      metadata: { name: "velero-demo-storage", labels },
      spec: {
        capacity: { storage: "2Gi" },
        accessModes: ["ReadWriteOnce"],
        persistentVolumeReclaimPolicy: "Retain",
        storageClassName: "",
        hostPath: { path: DATA_DIRECTORY, type: "Directory" },
        claimRef: { namespace: DEMO_NAMESPACE, name: "seaweedfs-data" },
      },
    },
    {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: metadata("seaweedfs-data"),
      spec: {
        accessModes: ["ReadWriteOnce"],
        storageClassName: "",
        volumeName: "velero-demo-storage",
        resources: { requests: { storage: "2Gi" } },
      },
    },
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: metadata("seaweedfs"),
      spec: {
        replicas: 1,
        strategy: { type: "Recreate" },
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            automountServiceAccountToken: false,
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 1000,
              runAsGroup: 1000,
              fsGroup: 1000,
              seccompProfile: { type: "RuntimeDefault" },
            },
            containers: [
              {
                name: "seaweedfs",
                image: preloadedImage(IMAGES.storage),
                imagePullPolicy: "Never",
                command: ["weed"],
                args: [
                  "server",
                  "-s3",
                  "-dir=/data",
                  "-ip=127.0.0.1",
                  "-ip.bind=127.0.0.1",
                  "-s3.ip.bind=0.0.0.0",
                  "-s3.port=8333",
                  "-s3.config=/etc/seaweedfs/s3.json",
                  "-master.telemetry=false",
                  "-master.volumeSizeLimitMB=128",
                  "-volume.max=8",
                  "-s3.iam=false",
                  "-s3.port.iceberg=0",
                  "-s3.port.lance=0",
                ],
                env: [{ name: "HOME", value: "/tmp" }],
                ports: [{ name: "s3", containerPort: 8333 }],
                resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "1", memory: "512Mi" } },
                securityContext: {
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                  capabilities: { drop: ["ALL"] },
                },
                startupProbe: { tcpSocket: { port: "s3" }, periodSeconds: 2, failureThreshold: 90 },
                readinessProbe: { tcpSocket: { port: "s3" }, periodSeconds: 2 },
                livenessProbe: { tcpSocket: { port: "s3" }, periodSeconds: 10 },
                volumeMounts: [
                  { name: "data", mountPath: "/data" },
                  { name: "auth", mountPath: "/etc/seaweedfs", readOnly: true },
                  { name: "tmp", mountPath: "/tmp" },
                ],
              },
            ],
            volumes: [
              { name: "data", persistentVolumeClaim: { claimName: "seaweedfs-data" } },
              { name: "auth", secret: { secretName: "seaweedfs-auth", defaultMode: 0o440 } },
              { name: "tmp", emptyDir: { sizeLimit: "64Mi" } },
            ],
          },
        },
      },
    },
    {
      apiVersion: "v1",
      kind: "Service",
      metadata: metadata("seaweedfs"),
      spec: { type: "ClusterIP", selector: labels, ports: [{ name: "s3", port: 8333, targetPort: "s3" }] },
    },
  ];
}
