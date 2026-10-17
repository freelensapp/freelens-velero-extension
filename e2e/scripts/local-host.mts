// What the proofs of the test environment give the main process in place of the host, which they run
// outside Freelens: the client of the proxy of Freelens for the API server of the cluster of a kubeconfig,
// and the kubectl and the environment Main.Shell gives for it. Both are made from the isolated kubeconfig of
// the environment, as SPEC-0015 says in D9: what the host itself adds, its proxy and its kubectl, is proven
// by the packaged suites.

import { mkdirSync, readFileSync } from "node:fs";
import { Agent, request } from "node:https";
import { join } from "node:path";
import { Readable } from "node:stream";
import { requireCondition } from "./local-kind.mts";

import type { HostAnswer, HostClient, HostRequestInit } from "../../src/main/diagnostic-kubernetes.ts";
import type { TunnelHost } from "../../src/main/diagnostic-tunnel.ts";
import type { KindConfig } from "./local-kind.mts";

export interface ProofHost {
  // The client of the host for the cluster of the kubeconfig.
  client(): HostClient;
  // The kubectl and the environment of the host for that cluster.
  tunnel: TunnelHost;
  // Ends what the stand-ins started.
  close(): Promise<void>;
}

// What the stand-ins are made of besides the kubeconfig: the kubectl of the environment and what it runs
// with, its environment without a kubeconfig and the folder of its cache, which the host gives its kubectl
// as well. A worker that runs where no kubectl is gives none, and asks for no tunnel.
export interface ProofShell {
  kubectl: string;
  environment: Record<string, string>;
  cache: string;
  // The working directory of kubectl: the folder of the extension, which the host gives.
  cwd: string;
}

// The credential of the one user of a kubeconfig of the environment: a certificate with its key, or a token.
type Credential = { cert: Buffer; key: Buffer } | { token: string };

function credentialOf(user: Record<string, unknown>): Credential {
  if (typeof user.token === "string" && user.token) return { token: user.token };
  requireCondition(
    typeof user["client-certificate-data"] === "string" && typeof user["client-key-data"] === "string",
    "The kubeconfig of a proof names neither a certificate with its key nor a token",
  );
  return {
    cert: Buffer.from(user["client-certificate-data"] as string, "base64"),
    key: Buffer.from(user["client-key-data"] as string, "base64"),
  };
}

// The client of the host for the API server of the one cluster of a kubeconfig: `getResponse` of
// `KubeJsonApi`, which answers whatever the status, with the status and the body as it arrives. It verifies
// the API server with the authority of the kubeconfig, sends the credential of its user, keeps no
// connection, and stops a request at its signal. Nothing of what it sends or reads is logged.
function hostClient(server: URL, authority: Buffer | undefined, credential: Credential, agent: Agent): HostClient {
  return {
    getResponse: (path, params, init: HostRequestInit) =>
      new Promise<HostAnswer>((resolve, reject) => {
        const query = new URLSearchParams(params?.query ?? {}).toString();
        const url = new URL(`${server.pathname.replace(/\/$/, "")}${path}${query ? `?${query}` : ""}`, server);
        const headers: Record<string, string> = { accept: "application/json", ...init.headers };

        if ("token" in credential) headers.authorization = `Bearer ${credential.token}`;
        if (init.body !== undefined) headers["content-length"] = String(Buffer.byteLength(init.body));
        const sent = request(
          url,
          {
            method: init.method,
            headers,
            agent,
            ca: authority,
            ...("cert" in credential ? { cert: credential.cert, key: credential.key } : {}),
            signal: init.signal,
          },
          (answer) => {
            const body = Readable.toWeb(answer) as unknown as ReadableStream<Uint8Array>;

            resolve({
              status: answer.statusCode ?? 0,
              body,
              text: () => new Response(body).text(),
            });
          },
        );

        // A request that does not reach the API server rejects as the fetch of the host does: with an error.
        sent.on("error", reject);
        sent.end(init.body);
      }),
  };
}

// The stand-ins for the one cluster of a kubeconfig of the environment, which the proof gives the main
// process as the host would: the catalog says the cluster is connected for as long as the proof runs.
export async function startProofHost(kubeconfig: string, context: string, shell?: ProofShell): Promise<ProofHost> {
  const config = JSON.parse(readFileSync(kubeconfig, "utf8")) as KindConfig;

  requireCondition(
    config.contexts.length === 1 &&
      config.clusters.length === 1 &&
      config.users.length === 1 &&
      config["current-context"] === context &&
      config.contexts[0].name === context,
    "The kubeconfig of a proof has one target, its context",
  );
  const { cluster } = config.clusters[0];

  requireCondition(!cluster["insecure-skip-tls-verify"], "The kubeconfig of a proof verifies the API server");
  const authority = cluster["certificate-authority-data"]
    ? Buffer.from(cluster["certificate-authority-data"], "base64")
    : undefined;
  const agent = new Agent({ keepAlive: false });
  const client = hostClient(new URL(cluster.server), authority, credentialOf(config.users[0].user), agent);
  const entry = (id: string) => ({
    id,
    name: "proof",
    kubeConfigPath: kubeconfig,
    contextName: context,
    status: "connected" as const,
  });

  if (shell) mkdirSync(shell.cache, { recursive: true, mode: 0o700 });
  return {
    client: () => client,
    tunnel: {
      kubectl: async () => {
        requireCondition(shell, "This proof runs where the host gives no kubectl");
        return shell.kubectl;
      },
      // The environment of the host for a cluster: its own, with the kubeconfig that reaches the cluster and
      // the folder of the cache of kubectl.
      environment: async () => {
        requireCondition(shell, "This proof runs where the host gives no kubectl");
        return { ...shell.environment, KUBECONFIG: kubeconfig, KUBECACHEDIR: join(shell.cache, "kubectl") };
      },
      entry,
      // The cluster of a proof stays connected while the proof runs: the state is told once.
      watchStatus: (_id, listener) => {
        listener("connected");
        return () => undefined;
      },
      cwd: () => shell?.cwd ?? process.cwd(),
    },
    close: async () => {
      agent.destroy();
    },
  };
}
