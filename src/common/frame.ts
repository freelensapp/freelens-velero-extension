// The frame a request comes from, read as the host names it. A cluster is shown in a frame of its own,
// whose address has the identifier of the cluster as the first label of its host, before the host of the
// window: `<identifier>.renderer.freelens.app` in the packaged application, `<identifier>.localhost` in
// development. The window of the host itself has no such label, and is the frame of no cluster.

// The identifier of the cluster of a frame, from the host of its address, or nothing for the window. It is
// the rule of the host, step by step: getClusterIdFromHost, in
// packages/core/src/common/utils/cluster-id-url-parsing.ts lines 14 to 27 at the validation target. The host
// writes the address of a frame as `//<identifier>.<host of the window>` (getClusterFrameUrl, lines 34 to 36
// of the same file), and reads the identifier back as the last label left once the port is taken off, then
// the last label when it is `localhost`, or the last three when they are `renderer.freelens.app`. The host
// reads it of no other host: a host that ends in neither is not one it writes for a frame, and is the frame
// of no cluster here. The form of an identifier is the contract's to check, where a request names one.
export function clusterOfHost(host: string): string | undefined {
  const labels = host.split(":")[0].split(".");

  if (labels[labels.length - 1] === "localhost") labels.pop();
  else if (labels.length >= 3 && labels.slice(-3).join(".") === "renderer.freelens.app") labels.splice(-3);
  else return undefined;
  // What the host reads as no identifier, an empty label, is none here as well.
  return labels[labels.length - 1] || undefined;
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
