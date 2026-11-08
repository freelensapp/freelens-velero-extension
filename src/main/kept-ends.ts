// The ends of the writes whose request was sent, kept for their cluster until a frame of that cluster has shown them,
// or the extension is deactivated (SPEC-0017, REQ-250; SPEC-0016, REQ-243). The frame that asked a write and showed
// its end says so; one that did not, because it went or its installation changed, leaves it for the target bar of any
// frame of that cluster, which asks for the ends at every read and is given those of its own cluster alone. Nothing is
// broadcast. A few are kept for each cluster: the oldest go first.

import { KEPT_ENDS_BOUND } from "../common/ipc";

import type { KeptEnd } from "../common/ipc";

export class KeptEnds {
  private readonly ends = new Map<string, KeptEnd[]>();

  keep(cluster: string, end: KeptEnd): void {
    const kept = (this.ends.get(cluster) ?? []).filter((one) => one.request !== end.request);

    this.ends.set(cluster, [...kept, end].slice(-KEPT_ENDS_BOUND));
  }

  list(cluster: string): KeptEnd[] {
    return [...(this.ends.get(cluster) ?? [])];
  }

  // A frame of the cluster showed the end: it is not kept any more.
  shown(cluster: string, request: string): void {
    const kept = (this.ends.get(cluster) ?? []).filter((one) => one.request !== request);

    if (kept.length) this.ends.set(cluster, kept);
    else this.ends.delete(cluster);
  }

  clear(): void {
    this.ends.clear();
  }
}
