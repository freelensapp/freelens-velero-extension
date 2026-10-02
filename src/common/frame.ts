// The frame a request comes from, read as the host names it. A cluster is shown in a frame of its own,
// whose address has the identifier of the cluster as the first label of its host, before the host of the
// window: `<identifier>.renderer.freelens.app` in the packaged application, `<identifier>.localhost` in
// development. The window of the host itself has no such label, and is the frame of no cluster.

const WINDOW_HOSTS = ["renderer.freelens.app", "localhost"];

// The identifier of the cluster of a frame, from the host of its address, or nothing for the window.
export function clusterOfHost(host: string): string | undefined {
  const labels = host.split(":")[0].split(".").filter(Boolean);

  for (const window of WINDOW_HOSTS) {
    const suffix = window.split(".");

    if (labels.length > suffix.length && labels.slice(-suffix.length).join(".") === window) {
      const identifier = labels[labels.length - suffix.length - 1];

      return typeof identifier === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(identifier) ? identifier : undefined;
    }
  }
  return undefined;
}

// The identifier of the cluster of a frame, from the whole address of the frame.
export function clusterOfAddress(address: string): string | undefined {
  try {
    return clusterOfHost(new URL(address).host);
  } catch {
    return undefined;
  }
}

// What a sender is known by: the cluster of its frame, and the process and the frame the host tells the
// frames of one window apart by. Every frame of the window has its own.
export function senderKey(cluster: string, processId: number, frameId: number): string {
  return `${cluster}:${processId}:${frameId}`;
}
