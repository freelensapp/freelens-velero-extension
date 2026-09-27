import { Renderer } from "@freelensapp/extensions";
import { Backup } from "./kinds";

import type { Reader } from "../state/installation";

// What reads the cluster for the views. It asks through the connection of the host to the cluster of this
// frame, with one verb, and gives back the status of the answer beside its body: the host turns a failed
// read into a text, and the state of a view does not come from a text.

interface Connection {
  getResponse(path: string, params?: unknown, init?: RequestInit): Promise<Response>;
}

let connection: Connection | undefined;

// The connection is the one an api of the host asks with. It is taken from one, created on the first read:
// nothing is asked of the host, nor of the cluster, before a view of Velero is opened.
function connect(): Connection | undefined {
  if (!connection) {
    const api = new Renderer.K8sApi.KubeApi({ objectConstructor: Backup }) as unknown as { request?: Connection };

    if (typeof api.request?.getResponse === "function") connection = api.request;
  }
  return connection;
}

export const readCluster: Reader = async (path, signal) => {
  const request = connect();

  // Without the connection nothing is known, and nothing is guessed.
  if (!request) return {};
  try {
    const response = await request.getResponse(path, undefined, { method: "GET", signal });
    const text = await response.text();

    try {
      return { status: response.status, body: JSON.parse(text) };
    } catch {
      return { status: response.status };
    }
  } catch {
    return {};
  }
};
