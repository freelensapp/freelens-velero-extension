import { Renderer } from "@freelensapp/extensions";

import type { Reader } from "../state/installation";

// What reads the cluster for the views. It asks through the client of the host for the cluster of this frame,
// `Renderer.K8sApi.KubeJsonApi.forCluster`, which goes through the proxy of Freelens to the origin of the
// frame, with one verb, and gives back the status of the answer beside its body: the state of a view comes
// from the status, and never from a text. The answer is the structural answer of the host and not a
// `Response` of the DOM: its status, its text and its header Date are read, and nothing else of it. No header
// and no query is sent. It creates no `KubeApi`, which would register itself with the host, and registers
// nothing.

// What the views read is of the kinds of Velero, and of nothing else: the discovery of the group, a kind
// in the whole cluster, a kind in one namespace. A Secret a location names is a name, and no path leads
// to it: what is not written as one of the three is not asked, in whatever way it is written.
const OF_VELERO = /^\/apis\/velero\.io\/v1(\/namespaces\/[a-z0-9]([-a-z0-9]*[a-z0-9])?)?(\/[a-z]+)?$/;

type Client = ReturnType<typeof Renderer.K8sApi.KubeJsonApi.forCluster>;
type Answer = Awaited<ReturnType<Client["getResponse"]>>;

// The header Date names a whole second, in the one form HTTP writes it in: the time it was written at is
// somewhere in that second, half a second after it on average.
const HALF_SECOND = 500;

// The time the answer says it was written at, and the clock of this machine in the middle of the request:
// the error of the difference of the two is half a second and half the time of the request at most. A
// header that is not the date of an instant written as HTTP writes one gives nothing, and an answer without
// headers gives nothing of the time and keeps what it says.
function written(answer: Answer, before: number, after: number): { date: number; at: number } | undefined {
  let header: string | null;

  try {
    header = typeof answer.headers?.get === "function" ? answer.headers.get("date") : null;
  } catch {
    // Headers that cannot be read give nothing of the time, and take nothing of what the answer says.
    return undefined;
  }
  if (!header) return undefined;
  const date = Date.parse(header);

  if (!Number.isFinite(date) || new Date(date).toUTCString() !== header) return undefined;
  return { date: date + HALF_SECOND, at: Math.round((before + after) / 2) };
}

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
      const before = Date.now();
      const answer = await client.getResponse(path, undefined, { method: "GET", signal });
      // The answer came: its header was written before its body is read.
      const time = written(answer, before, Date.now());
      const status = answer.status;
      const text = await answer.text();

      try {
        return { status, body: JSON.parse(text), ...time };
      } catch {
        return { status, ...time };
      }
    } catch {
      // Without an answer nothing is known, and nothing is guessed.
      return {};
    }
  };
}
