// What the proofs of the test environment give the main process in place of the host, which they run
// outside Freelens: the client of the proxy of Freelens for the API server of the cluster of a kubeconfig,
// and the kubectl and the environment Main.Shell gives for it. Both are made from the isolated kubeconfig of
// the environment, as SPEC-0015 says in D9: what the host itself adds, its proxy and its kubectl, is proven
// by the packaged suites.

import type { HostClient } from "../../src/main/diagnostic-kubernetes.ts";
import type { TunnelHost } from "../../src/main/diagnostic-tunnel.ts";

export interface ProofHost {
  // The client of the host for the cluster of the kubeconfig.
  client(): HostClient;
  // The kubectl and the environment of the host for that cluster.
  tunnel: TunnelHost;
  // Ends what the stand-ins started.
  close(): Promise<void>;
}

// The stand-ins are written with the packaged suites, the ninth step of T0.7: until then the proofs do not
// run on the main process of Freelens v2, and say so before they ask the cluster anything.
export async function startProofHost(_kubeconfig: string, _context: string): Promise<ProofHost> {
  throw new Error(
    "The transport proof does not run on the main process of Freelens v2 yet: its stand-ins of Main.K8sApi and Main.Shell come with the packaged suites.",
  );
}
