import { describe, expect, it } from "vitest";
import { KEPT_ENDS_BOUND } from "../common/ipc";
import { KeptEnds } from "./kept-ends";

import type { KeptEnd } from "../common/ipc";

function end(request: string, at: number): KeptEnd {
  return {
    request,
    kind: "backup-from-schedule",
    namespace: "velero",
    context: "kind-a",
    name: `daily-${at}`,
    schedule: "daily",
    outcome: { created: true },
    at,
  };
}

describe("the ends kept for a cluster", () => {
  it("keeps the newest of each cluster within the bound, one for each request, and lets one go once it was shown", () => {
    const kept = new KeptEnds();

    for (let at = 0; at <= KEPT_ENDS_BOUND; at += 1) kept.keep("cluster-a", end(`request-${at}`, at));
    kept.keep("cluster-b", end("request-b", 0));
    const ofA = kept.list("cluster-a");

    expect(ofA).toHaveLength(KEPT_ENDS_BOUND);
    expect(ofA[0].request).toBe("request-1");
    // The same request kept again is one end, the newest.
    kept.keep("cluster-a", end("request-5", 99));
    expect(kept.list("cluster-a").filter((one) => one.request === "request-5")).toEqual([end("request-5", 99)]);
    kept.shown("cluster-a", "request-5");
    expect(kept.list("cluster-a").some((one) => one.request === "request-5")).toBe(false);
    // The others of the cluster stay.
    expect(kept.list("cluster-a")).toHaveLength(KEPT_ENDS_BOUND - 1);
    expect(kept.list("cluster-b")).toEqual([end("request-b", 0)]);
    kept.shown("cluster-b", "request-b");
    expect(kept.list("cluster-b")).toEqual([]);
    kept.clear();
    expect(kept.list("cluster-a")).toEqual([]);
    // The extension went: a run still in flight keeps nothing.
    kept.keep("cluster-a", end("request-late", 1));
    expect(kept.list("cluster-a")).toEqual([]);
  });
});
