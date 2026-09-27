import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { FIXTURE_LABEL, fixtureArtifactPaths, fixtureNames } from "./local-fixtures.mts";
import { DEMO_CONTEXT, DEMO_NAMESPACE, OWNER_LABEL, requireCondition, SUBNETS, subnetsOverlap } from "./local-kind.mts";
import { type KubeResource, STORAGE_ENDPOINT } from "./local-manifests.mts";

import type { ArtifactTarget, DiagnosticKind } from "../../src/main/diagnostic-kubernetes.ts";
import type { DiagnosticInput } from "../../src/main/diagnostic-service.ts";

export { DIRECT_PROOF_IMAGE } from "./local-manifests.mts";

export interface DownloadProofContext {
  owner: string;
  run: string;
  kubeconfig: string;
  pod: { name: string; uid: string };
  origin?: string;
  port?: number;
  direct?: boolean;
  assertCurrent(): void;
  record(kind: DiagnosticKind, identity: { name: string; uid: string }): void;
}

export function compiledDiagnostics(): typeof import("../../src/main/index.ts") {
  const globals = globalThis as typeof globalThis & { LensExtensions?: unknown };
  const previous = globals.LensExtensions;

  globals.LensExtensions = { Main: { LensExtension: class {} }, Common: {}, Renderer: {} };
  try {
    return createRequire(import.meta.url)(
      fileURLToPath(new URL("../../out/main/index.js", import.meta.url)),
    ) as typeof import("../../src/main/index.ts");
  } finally {
    if (previous === undefined) delete globals.LensExtensions;
    else globals.LensExtensions = previous;
  }
}

export function tlsProofResources(
  owner: string,
  run: string,
  originals: KubeResource[],
  certificate: { ca: string; cert: string; key: string },
): KubeResource[] {
  const [deployment, service, location] = structuredClone(originals);

  requireCondition(
    deployment.kind === "Deployment" && service.kind === "Service" && location.kind === "BackupStorageLocation",
    "Unexpected TLS proof baseline",
  );
  const tlsName = `proof-tls-${run}`;
  const caName = `proof-ca-${run}`;
  const metadata = (name: string) => ({
    name,
    namespace: DEMO_NAMESPACE,
    labels: { [OWNER_LABEL]: owner, [FIXTURE_LABEL]: run },
  });
  const workload = deployment.spec as {
    template: {
      spec: {
        containers: {
          name: string;
          args: string[];
          ports: { name: string; containerPort: number }[];
          volumeMounts: { name: string; mountPath: string; readOnly?: boolean }[];
        }[];
        volumes: unknown[];
      };
    };
  };
  const container = workload.template.spec.containers.find((value) => value.name === "seaweedfs");

  requireCondition(container, "Owned storage container is missing");
  container.args.push(
    "-s3.port.https=8443",
    "-s3.cert.file=/etc/proof-tls/tls.crt",
    "-s3.key.file=/etc/proof-tls/tls.key",
  );
  container.ports.push({ name: "s3-https", containerPort: 8443 });
  container.volumeMounts.push({ name: "proof-tls", mountPath: "/etc/proof-tls", readOnly: true });
  workload.template.spec.volumes.push({ name: "proof-tls", secret: { secretName: tlsName, defaultMode: 0o440 } });
  (service.spec as { ports: unknown[] }).ports.push({ name: "s3-https", port: 8443, targetPort: "s3-https" });
  const spec = location.spec as { config: Record<string, string>; objectStorage: Record<string, unknown> };

  spec.config.s3Url = STORAGE_ENDPOINT.replace("http:", "https:").replace(":8333", ":8443");
  spec.objectStorage.caCert = Buffer.from(certificate.ca).toString("base64");
  delete spec.objectStorage.caCertRef;
  return [
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: metadata(tlsName),
      type: "kubernetes.io/tls",
      stringData: { "tls.crt": certificate.cert, "tls.key": certificate.key },
    },
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: metadata(caName),
      type: "Opaque",
      stringData: { "ca.crt": certificate.ca },
    },
    deployment,
    service,
    location,
  ];
}

export async function runDownloadProof(context: DownloadProofContext): Promise<{
  downloads: number;
  generatedNames: boolean;
  conflictRefused: boolean;
  invalidSignature: boolean;
  invalidHost: boolean;
  untrustedCa: boolean;
}> {
  const main = compiledDiagnostics();
  const api = new main.DiagnosticKubernetes(
    { clusterId: context.owner, context: DEMO_CONTEXT, kubeconfigPath: context.kubeconfig },
    () => {
      context.assertCurrent();
      return true;
    },
    { [OWNER_LABEL]: context.owner, [FIXTURE_LABEL]: context.run },
  );
  const names = fixtureNames(context.run);
  const artifacts = fixtureArtifactPaths(context.run);
  const paths: Partial<Record<ArtifactTarget, string>> = {
    BackupLog: artifacts.backupLog,
    BackupResults: artifacts.backupResults,
    RestoreLog: artifacts.restoreLog,
    RestoreResults: artifacts.restoreResults,
  };
  const controller = new AbortController();
  const origin = context.origin ?? STORAGE_ENDPOINT;
  const port = context.port ?? 8333;
  let invalidSignature = false;
  let invalidHost = false;
  let untrustedCa = false;
  const newConnection = async (signal: AbortSignal) => {
    if (!context.direct) return main.openPodTunnel(api, { ...context.pod, namespace: DEMO_NAMESPACE, port }, signal);
    const pod = await api.read("Pod", DEMO_NAMESPACE, context.pod.name, signal);
    const address = pod.status?.podIP;

    requireCondition(
      pod.metadata.uid === context.pod.uid &&
        pod.metadata.namespace === DEMO_NAMESPACE &&
        pod.metadata.labels?.[OWNER_LABEL] === context.owner &&
        typeof address === "string" &&
        subnetsOverlap(SUBNETS.pods, address),
      "Direct proof pod identity or address changed",
    );
    return { address, port, close: async () => {} };
  };
  const service = new main.DiagnosticService(api, {
    onCreated: (identity) => context.record("DownloadRequest", identity),
    route: async (url, input, storage, signal) => {
      const parsed = new URL(url);
      const config = storage.spec?.config as { s3Url?: string; publicUrl?: string } | undefined;

      requireCondition(
        config?.s3Url === origin &&
          !config.publicUrl &&
          parsed.origin === origin &&
          parsed.pathname === paths[input.target],
        "Unexpected fixture artifact origin or target",
      );
      const tunnel = await newConnection(signal);

      return {
        route: {
          origin,
          pathname: paths[input.target] ?? "",
          address: tunnel.address,
          port: tunnel.port,
          mode: context.direct ? "direct" : "tunnel",
          allowPrivate: context.direct,
          allowHttp: origin.startsWith("http:"),
        },
        close: tunnel.close,
      };
    },
    download: async (url, route, signal) => {
      const content = await main.downloadArtifact(url, route, signal);

      if (!invalidSignature) {
        const altered = new URL(url);

        requireCondition(altered.searchParams.has("X-Amz-Signature"), "Expected a server-signed fixture URL");
        altered.searchParams.set("X-Amz-Signature", "0".repeat(64));
        const tunnel = await newConnection(signal);

        try {
          await main.downloadArtifact(altered.href, { ...route, port: tunnel.port }, signal);
        } catch (error) {
          invalidSignature = error instanceof main.DiagnosticError && error.code === "request-failed";
        } finally {
          await tunnel.close();
        }
        requireCondition(invalidSignature, "Storage did not reject an altered signature");
        const second = await newConnection(signal);

        try {
          if (origin.startsWith("https:")) {
            try {
              await main.downloadArtifact(url, { ...route, port: second.port, ca: undefined }, signal);
            } catch (error) {
              untrustedCa = error instanceof main.DiagnosticError && error.code === "tls-invalid";
            }
            requireCondition(untrustedCa, "The TLS proof succeeded without its private CA");
          } else {
            const wrongHost = new URL(url);

            wrongHost.hostname = "wrong-host.example.invalid";
            try {
              await main.downloadArtifact(
                wrongHost.href,
                { ...route, origin: wrongHost.origin, port: second.port },
                signal,
              );
            } catch (error) {
              invalidHost = error instanceof main.DiagnosticError && error.code === "request-failed";
            }
            requireCondition(invalidHost, "Storage did not reject a changed signed Host");
          }
        } finally {
          await second.close();
        }
      }
      return content;
    },
  });
  service.enableWrites(DEMO_NAMESPACE);
  let downloads = 0;

  try {
    for (const target of ["BackupLog", "BackupResults", "RestoreLog", "RestoreResults"] as const) {
      const kind = target.startsWith("Backup") ? "Backup" : "Restore";
      const objectName = kind === "Backup" ? names.backup : names.restore;
      const object = await api.read(kind, DEMO_NAMESPACE, objectName, controller.signal);
      const selection = {
        clusterId: context.owner,
        context: DEMO_CONTEXT,
        namespace: DEMO_NAMESPACE,
        target,
        name: objectName,
        uid: object.metadata.uid,
      };
      const input: DiagnosticInput = {
        ...selection,
        requestId: randomUUID(),
        confirmation: service.confirm(1, selection),
      };
      const operation = service.run(1, input, controller.signal);

      requireCondition(
        operation === service.run(1, input, controller.signal),
        "Live request ID did not rejoin the operation",
      );
      const result = await operation;

      requireCondition(
        result.content.length > 0 && !Object.hasOwn(result, "downloadURL"),
        "Live artifact result is invalid",
      );
      if (target.endsWith("Results")) JSON.parse(result.content.toString("utf8"));
      downloads += 1;
    }
    const collisionName = `${names.backup}-${randomUUID()}`;
    const requestId = randomUUID();
    const created = await api.createDownload(
      DEMO_NAMESPACE,
      "BackupLog",
      names.backup,
      collisionName,
      requestId,
      controller.signal,
    );

    context.record("DownloadRequest", created.metadata);
    let conflict = false;

    try {
      await api.createDownload(DEMO_NAMESPACE, "BackupLog", names.backup, collisionName, requestId, controller.signal);
    } catch (error) {
      conflict = error instanceof main.DiagnosticError && error.code === "conflict";
    }
    requireCondition(
      conflict &&
        (await api.read("DownloadRequest", DEMO_NAMESPACE, collisionName, controller.signal)).metadata.uid ===
          created.metadata.uid,
      "Collision did not preserve the original request",
    );
    const generated = await api.createGenerated(
      "ServerStatusRequest",
      DEMO_NAMESPACE,
      `proof-${context.run}-`,
      controller.signal,
    );

    context.record("ServerStatusRequest", generated.metadata);
    requireCondition(
      generated.metadata.name.startsWith(`proof-${context.run}-`) && !!generated.metadata.uid,
      "API-generated request name missing",
    );
    const deadline = Date.now() + 10_000;
    let status = generated;

    while (status.status?.phase !== "Processed") {
      requireCondition(Date.now() < deadline, "Local server-status request timed out");
      await delay(250);
      status = await api.read("ServerStatusRequest", DEMO_NAMESPACE, generated.metadata.name, controller.signal);
    }
    requireCondition(typeof status.status?.serverVersion === "string", "Local server-status response missing version");
    return { downloads, generatedNames: true, conflictRefused: true, invalidSignature, invalidHost, untrustedCa };
  } finally {
    controller.abort();
    service.invalidate();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireCondition(
      process.argv.length === 3 && process.argv[2] === "--direct",
      "Only the explicit direct proof worker is supported",
    );
    const input = JSON.parse(readFileSync("/proof-state/input.json", "utf8")) as Omit<
      DownloadProofContext,
      "record" | "assertCurrent" | "kubeconfig"
    > & { kubeconfigHash: string };
    const config = "/proof-state/kubeconfig";
    const result = await runDownloadProof({
      ...input,
      direct: true,
      kubeconfig: config,
      assertCurrent: () => {
        requireCondition(
          createHash("sha256").update(readFileSync(config)).digest("hex") === input.kubeconfigHash,
          "Direct proof kubeconfig changed",
        );
      },
      record: (kind, identity) => {
        console.log(JSON.stringify({ created: { kind, ...identity } }));
      },
    });

    console.log(JSON.stringify({ result, nodeVersion: process.version }));
  } catch {
    console.error("Direct compiled diagnostic proof failed; URL and credentials withheld.");
    process.exitCode = 1;
  }
}
