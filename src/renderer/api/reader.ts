import { Renderer } from "@freelensapp/extensions";

import type { Reader } from "../state/installation";

// What reads the cluster for the views. It asks through the client of the host for the cluster of this frame,
// `Renderer.K8sApi.KubeJsonApi.forCluster`, which goes through the proxy of Freelens to the origin of the
// frame, with one verb, and gives back the status of the answer beside its body: the state of a view comes
// from the status, and never from a text. The answer is the structural answer of the host and not a
// `Response` of the DOM: its status and its text are read, and nothing else of it. No header and no query is
// sent. It creates no `KubeApi`, which would register itself with the host, and registers nothing.

// What the views read is of the kinds of Velero, and of nothing else: the discovery of the group, a kind
// in the whole cluster, a kind in one namespace. A Secret a location names is a name, and no path leads
// to it: what is not written as one of the three is not asked, in whatever way it is written.
const OF_VELERO = /^\/apis\/velero\.io\/v1(\/namespaces\/[a-z0-9]([-a-z0-9]*[a-z0-9])?)?(\/[a-z]+)?$/;

type Client = ReturnType<typeof Renderer.K8sApi.KubeJsonApi.forCluster>;

// The reader of one cluster, the one of the frame. The client of the host is taken at the first read:
// nothing is asked of the host, nor of the cluster, before a view of Velero reads.
export function clusterReader(cluster: string): Reader {
  let client: Client | undefined;

  return async (path, signal) => {
    // A path that is not of the kinds of Velero is not asked, and nothing is asked of no cluster: nothing is
    // known of either.
    if (!cluster || !OF_VELERO.test(path)) return {};
    try {
      client ??= Renderer.K8sApi.KubeJsonApi.forCluster(cluster);
      const answer = await client.getResponse(path, undefined, { method: "GET", signal });
      const status = answer.status;
      const text = await answer.text();

      try {
        return { status, body: JSON.parse(text) };
      } catch {
        return { status };
      }
    } catch {
      // Without an answer nothing is known, and nothing is guessed.
      return {};
    }
  };
}
