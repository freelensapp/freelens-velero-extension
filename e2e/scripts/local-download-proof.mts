import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { FIXTURE_LABEL, fixtureArtifactPath, fixtureNames } from "./local-fixtures.mts";
import { DEMO_CONTEXT, DEMO_NAMESPACE, OWNER_LABEL, requireCondition, SUBNETS, subnetsOverlap } from "./local-kind.mts";
import { type KubeResource, STORAGE_ENDPOINT } from "./local-manifests.mts";

import type { Answer, ArtifactPage, ArtifactValue, WriteConfirmAnswer } from "../../src/common/ipc.ts";
import type { DiagnosticKind } from "../../src/main/diagnostic-kubernetes.ts";

export { DIRECT_PROOF_IMAGE } from "./local-manifests.mts";

export interface DownloadProofContext {
  owner: string;
  run: string;
  kubeconfig: string;
  pod: { name: string; uid: string };
  origin?: string;
  port?: number;
  direct?: boolean;
  // The operations the server refused, when the proof asks for their artifacts as well: a backup and a
  // restore that failed their validation, and a restore without a backup.
  refused?: Record<"backup" | "restore" | "orphan", { name: string; uid: string }>;
  assertCurrent(): void;
  record(kind: DiagnosticKind, identity: { name: string; uid: string }): void;
}

// The compiled main process, loaded where there is no host. It is given what it asks of the host when it
// loads, as names and nothing under them: the proofs run its diagnostic code, which uses none of it, and
// need no package installed.
export function compiledDiagnostics(): typeof import("../../src/main/index.ts") {
  const globals = globalThis as typeof globalThis & { LensExtensions?: unknown; Mobx?: unknown };
  const previous = { sdk: globals.LensExtensions, state: globals.Mobx };

  globals.LensExtensions = {
    Main: { LensExtension: class {}, Ipc: class {} },
    Common: { Store: { ExtensionStore: class {} } },
    Renderer: {},
  };
  globals.Mobx = {};
  try {
    return createRequire(import.meta.url)(
      fileURLToPath(new URL("../../out/main/index.js", import.meta.url)),
    ) as typeof import("../../src/main/index.ts");
  } finally {
    if (previous.sdk === undefined) delete globals.LensExtensions;
    else globals.LensExtensions = previous.sdk;
    if (previous.state === undefined) delete globals.Mobx;
    else globals.Mobx = previous.state;
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
  missingArtifacts: number;
  refusedBeforeCreation: boolean;
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
  // The path of an artifact of an operation of this run: the four the proof asks for, and no other.
  const pathOf = (target: string, name: string) => {
    requireCondition(
      target === "BackupLog" || target === "BackupResults" || target === "RestoreLog" || target === "RestoreResults",
      "Unexpected fixture artifact",
    );
    return fixtureArtifactPath(context.run, target, name);
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
  // The procedures of the main process, as the extension registers them with the host: the proof calls
  // them as a frame of the cluster does, with the gate, its confirmations and its tokens. The cluster is
  // the one entry of a catalog of the proof, and the requests carry the labels of the environment beside
  // the ones of the extension, so that the environment knows them as its own.
  const cluster = "velero-proof";
  const catalog = [{ id: cluster, name: "proof", kubeConfigPath: context.kubeconfig, contextName: DEMO_CONTEXT }];
  const gate = new main.WriteGate({
    catalog: () => catalog,
    adapter: (entry, isCurrent) =>
      new main.DiagnosticKubernetes(
        { clusterId: entry.id, context: entry.contextName, kubeconfigPath: entry.kubeConfigPath },
        () => {
          context.assertCurrent();
          return isCurrent();
        },
        {
          "app.kubernetes.io/managed-by": "freelens-velero-extension",
          [OWNER_LABEL]: context.owner,
          [FIXTURE_LABEL]: context.run,
        },
      ),
  });
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
  const frame = { senderFrame: { url: `https://${cluster}.renderer.freelens.app:1/` }, processId: 1, frameId: 1 };
  const release = main.registerHandlers(
    {
      handle: (channel, handler) =>
        handlers.set(channel, handler as (event: unknown, payload: unknown) => Promise<unknown>),
      broadcast: () => undefined,
    },
    {
      catalog: () => catalog,
      gate,
      // The route of the proof: the origin and the path the fixtures have, through a tunnel to the pod of
      // the storage or to its address. The route of the main process comes with its own slice.
      route: async (url, input, storage, signal) => {
        const parsed = new URL(url);
        const config = storage.spec?.config as { s3Url?: string; publicUrl?: string } | undefined;

        const pathname = pathOf(input.target, input.name);

        requireCondition(
          config?.s3Url === origin && !config.publicUrl && parsed.origin === origin && parsed.pathname === pathname,
          "Unexpected fixture artifact origin or target",
        );
        const tunnel = await newConnection(signal);

        return {
          route: {
            origin,
            pathname,
            address: tunnel.address,
            port: tunnel.port,
            mode: context.direct ? "direct" : "tunnel",
            allowPrivate: context.direct,
            allowHttp: origin.startsWith("http:"),
          },
          close: tunnel.close,
        };
      },
      download: {
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
      },
    },
  );
  // A call of a procedure, from the frame of the cluster of the proof. A failure says its code and its
  // step, which name nothing of the environment; its words are not printed.
  const call = async <Value,>(channel: string, payload: unknown): Promise<Value> => {
    const handler = handlers.get(channel);

    requireCondition(handler, "A procedure of the main process is not registered");
    const answer = (await handler(frame, payload)) as Answer<Value>;

    if (!answer.ok) throw new Error(`The procedure ${channel} failed: ${answer.code} at ${answer.stage}`);
    return answer.value;
  };
  // The answer of a run that is expected not to end with its text: its code and its step.
  const refusal = async (
    target: { kind: "Backup" | "Restore"; name: string; uid: string },
    artifact: "BackupLog" | "RestoreLog",
    request: string,
  ): Promise<{ code: string; stage: string }> => {
    const { token } = await call<WriteConfirmAnswer>("write.confirm", {
      cluster,
      namespace: DEMO_NAMESPACE,
      kind: "DownloadRequest",
      target,
      artifact,
    });
    const handler = handlers.get("write.run");

    requireCondition(handler, "A procedure of the main process is not registered");
    const answer = (await handler(frame, {
      cluster,
      namespace: DEMO_NAMESPACE,
      kind: "DownloadRequest",
      target,
      artifact,
      token,
      request,
    })) as Answer<ArtifactValue>;

    requireCondition(!answer.ok, "An artifact of an operation the server refused was downloaded");
    requireCondition(
      !/X-Amz|downloadURL|[?]|https?:/.test(JSON.stringify(answer)),
      "A failure of the proof carries a URL",
    );
    return { code: answer.code, stage: answer.stage };
  };
  // Whether a request of that name is in the cluster, and its identity when it is.
  const requestOf = (name: string) =>
    api.read("DownloadRequest", DEMO_NAMESPACE, name, controller.signal).then(
      (found) => ({ name, uid: found.metadata.uid }),
      (error: unknown) => {
        requireCondition(
          error instanceof main.DiagnosticError && error.code === "not-found",
          "A request of the proof could not be looked for",
        );
        return undefined;
      },
    );
  let downloads = 0;
  let missingArtifacts = 0;
  let refusedBeforeCreation = false;

  try {
    await call("gate.enable", {
      cluster,
      namespace: DEMO_NAMESPACE,
      confirmation: { context: DEMO_CONTEXT, namespace: DEMO_NAMESPACE },
    });
    for (const artifact of ["BackupLog", "BackupResults", "RestoreLog", "RestoreResults"] as const) {
      const kind = artifact.startsWith("Backup") ? "Backup" : "Restore";
      const objectName = kind === "Backup" ? names.backup : names.restore;
      const object = await api.read(kind, DEMO_NAMESPACE, objectName, controller.signal);
      const target = { kind, name: objectName, uid: object.metadata.uid };
      const { token } = await call<WriteConfirmAnswer>("write.confirm", {
        cluster,
        namespace: DEMO_NAMESPACE,
        kind: "DownloadRequest",
        target,
        artifact,
      });
      const request = randomUUID();
      const run = { cluster, namespace: DEMO_NAMESPACE, kind: "DownloadRequest", target, artifact, token, request };
      // The same request sent again while it runs joins it: one object is created for the two.
      const [result, joined] = await Promise.all([
        call<ArtifactValue>("write.run", run),
        call<ArtifactValue>("write.run", run),
      ]);

      requireCondition(result === joined, "Live request ID did not rejoin the operation");
      context.record("DownloadRequest", result.request);
      requireCondition(
        result.request.name === `${objectName}-${request}` &&
          result.size > 0 &&
          result.pages > 0 &&
          result.route.origin === origin &&
          result.route.mode === (context.direct ? "direct" : "tunnel") &&
          result.route.encrypted === origin.startsWith("https:") &&
          !/X-Amz|downloadURL|[?]/.test(JSON.stringify(result)),
        "Live artifact result is invalid",
      );
      // The text is held by the main process and given in pages, to the frame that asked for it.
      let content = "";

      for (let page = 0; page < result.pages; page += 1)
        content += (await call<ArtifactPage>("artifact.page", { cluster, request, page })).text;
      requireCondition(Buffer.byteLength(content) === result.size, "Live artifact pages do not hold the whole text");
      if (artifact.endsWith("Results")) JSON.parse(content);
      await call<null>("artifact.release", { cluster, request });
      requireCondition(
        await call<ArtifactPage>("artifact.page", { cluster, request, page: 0 }).then(
          () => false,
          () => true,
        ),
        "A text that was let go is still given",
      );
      downloads += 1;
    }
    // What the server and the store answer when there is nothing to download.
    if (context.refused) {
      // An operation that failed its validation wrote nothing into the store, and its backup and its
      // storage location are valid: the server signs a URL, and the store says that it has no such file.
      for (const [target, artifact] of [
        [{ kind: "Backup", ...context.refused.backup }, "BackupLog"],
        [{ kind: "Restore", ...context.refused.restore }, "RestoreLog"],
      ] as const) {
        const request = randomUUID();
        const ended = await refusal(target, artifact, request);
        const created = await requestOf(`${target.name}-${request}`);

        // The request was created for it, and stays: the proof removes it with the others.
        requireCondition(created, "No request was created for an artifact the store was asked for");
        context.record("DownloadRequest", created);
        requireCondition(
          ended.code === "artifact-missing" && ended.stage === "download",
          `A file the store does not have ended as ${ended.code} at ${ended.stage}`,
        );
        missingArtifacts += 1;
      }
      // A restore that names no backup: the server would sign no URL, and no request is created for it.
      const request = randomUUID();
      const ended = await refusal({ kind: "Restore", ...context.refused.orphan }, "RestoreLog", request);

      requireCondition(
        ended.code === "not-found" && ended.stage === "backup",
        `A restore without a backup ended as ${ended.code} at ${ended.stage}`,
      );
      requireCondition(
        !(await requestOf(`${context.refused.orphan.name}-${request}`)),
        "A request was created for a restore without a backup",
      );
      refusedBeforeCreation = true;
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
    return {
      downloads,
      generatedNames: true,
      conflictRefused: true,
      invalidSignature,
      invalidHost,
      untrustedCa,
      missingArtifacts,
      refusedBeforeCreation,
    };
  } finally {
    controller.abort();
    release();
    api.dispose();
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
