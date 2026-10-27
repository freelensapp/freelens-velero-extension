import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_RANK,
  maintenanceResult,
  phaseRank,
  READINESS_RANK,
  repositoryReadiness,
  unwrittenResult,
  VOLUME_PHASES,
  volumeOperationState,
  writtenType,
} from "./volume-phases";
import { axesText, NODE_AGENT_WORDS, phaseSentence, volumePhaseText } from "./volume-words";

import type { VolumeKind } from "./volume-phases";

// The phases of the operations of the volumes on their two axes and the outcome, as SPEC-0014 tables them (the
// phases, lines 270 to 280), for each of the two kinds of the file system backup.
const TABLE: [unknown, string, string, string, boolean, string][] = [
  // phase, lifecycle, execution, outcome, cancellation asked, label
  [undefined, "in-flight", "not-started", "none", false, "No phase yet"],
  ["", "in-flight", "not-started", "none", false, "No phase yet"],
  ["New", "in-flight", "not-started", "none", false, "New"],
  ["Accepted", "in-flight", "not-started", "none", false, "Accepted"],
  ["Prepared", "in-flight", "not-started", "none", false, "Prepared"],
  ["InProgress", "in-flight", "running", "none", false, "In progress"],
  ["Canceling", "in-flight", "running", "none", true, "Canceling"],
  ["Completed", "terminal", "ran", "completed", false, "Completed"],
  ["Failed", "terminal", "ran-or-not-started", "failed", false, "Failed"],
  ["Canceled", "terminal", "ran-or-not-started", "cancelled", false, "Canceled"],
  ["Paused", "unknown", "unknown", "unknown", false, "Unknown"],
  // A phase of a backup is not a phase of an operation of a volume.
  ["PartiallyFailed", "unknown", "unknown", "unknown", false, "Unknown"],
];

describe.each(["PodVolumeBackup", "PodVolumeRestore"] as VolumeKind[])("the phase of a %s", (kind) => {
  it.each(TABLE)("%s is %s, %s, %s", (phase, lifecycle, execution, outcome, cancelAsked, label) => {
    const state = volumeOperationState(kind, phase);

    expect(state).toEqual({
      kind,
      ...(phase ? { reported: phase } : {}),
      recognized: lifecycle !== "unknown",
      lifecycle,
      execution,
      outcome,
      cancelAsked,
      label,
    });
  });

  it("keeps a phase the release does not write as its text, with the mark of what is not known", () => {
    expect(volumePhaseText(volumeOperationState(kind, "Paused"))).toBe("Unknown: Paused");
    expect(volumePhaseText(volumeOperationState(kind, 3))).toBe("Unknown: 3");
    expect(volumePhaseText(volumeOperationState(kind, "InProgress"))).toBe("In progress");
  });

  it("says of each phase what the release does in it, a phase not reported being no failure", () => {
    const said = (phase: unknown) => phaseSentence(volumeOperationState(kind, phase));

    expect(said(undefined)).toBe(NODE_AGENT_WORDS[kind]);
    expect(said("New")).toBe(NODE_AGENT_WORDS[kind]);
    expect(NODE_AGENT_WORDS[kind]).toContain("waiting is not a failure");
    expect(NODE_AGENT_WORDS[kind]).toContain("not read by the extension");
    expect(said("Accepted")).toContain("preparing timeout");
    expect(said("Accepted")).toContain("a pod is being made to reach the volume");
    expect(said("Prepared")).toContain("about to start the data path");
    expect(said("InProgress")).toContain("moving the bytes");
    expect(said("Canceling")).toContain("being stopped");
    expect(said("Completed")).toBe("The data path ended.");
    expect(said("Failed")).toContain("A start equal to the completion is one the failure wrote");
    expect(said("Failed")).toContain("no time at all is one the preparing timeout wrote");
    expect(said("Canceled")).toContain("neither a success nor a failure");
    expect(said("Paused")).toContain("shown as written");
  });

  it("says the axes in words, a cancellation as neither a success nor a failure", () => {
    expect(axesText(volumeOperationState(kind, "Canceled"))).toBe(
      "Finished, ran or not started, as its times say, canceled, which is neither a success nor a failure",
    );
    expect(axesText(volumeOperationState(kind, "Canceling"))).toBe("In flight, running, cancellation asked");
    expect(axesText(volumeOperationState(kind, "Failed"))).toBe(
      "Finished, ran or not started, as its times say, failed",
    );
    expect(axesText(volumeOperationState(kind, undefined))).toBe("In flight, not started, no outcome yet");
  });
});

describe("the words for an operation that waits for a node agent", () => {
  it("name the node of the pod for a backup, and the init container of the restored pod for a restore", () => {
    expect(NODE_AGENT_WORDS.PodVolumeBackup).toContain("the node agent of the node of its pod");
    expect(NODE_AGENT_WORDS.PodVolumeRestore).toContain("the init container restore-wait");
  });
});

describe("the order of the phases in a list", () => {
  it("is the lifecycle, then the phase in it from the first to the last, what is not known last", () => {
    const ranked = [undefined, ...VOLUME_PHASES, "Paused"]
      .map((phase) => volumeOperationState("PodVolumeBackup", phase))
      .map((state) => [LIFECYCLE_RANK[state.lifecycle], phaseRank(state)]);

    expect(ranked).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [0, 5],
      [1, 6],
      [1, 7],
      [1, 8],
      [2, 9],
    ]);
    for (const [lifecycle, rank] of ranked) {
      expect(Number.isNaN(lifecycle)).toBe(false);
      expect(Number.isNaN(rank)).toBe(false);
    }
  });
});

describe("the readiness of a repository", () => {
  it.each([
    [undefined, "not-initialized", "Not initialized yet"],
    ["", "not-initialized", "Not initialized yet"],
    ["New", "not-initialized", "Not initialized yet"],
    ["Ready", "ready", "Ready"],
    ["NotReady", "not-ready", "Not ready"],
    ["Broken", "unknown", "Unknown"],
  ])("%s is %s", (phase, readiness, label) => {
    expect(repositoryReadiness(phase)).toEqual({ ...(phase ? { reported: phase } : {}), readiness, label });
  });

  it("is ordered Ready, NotReady, not initialized, then what is not known", () => {
    expect(
      ["Broken", undefined, "NotReady", "Ready"]
        .map((phase) => repositoryReadiness(phase))
        .sort((one, other) => READINESS_RANK[one.readiness] - READINESS_RANK[other.readiness])
        .map((readiness) => readiness.readiness),
    ).toEqual(["ready", "not-ready", "not-initialized", "unknown"]);
  });
});

describe("the result of a maintenance", () => {
  it("is Succeeded, Failed, or another value kept as text", () => {
    expect(maintenanceResult("Succeeded")).toEqual({ reported: "Succeeded", result: "succeeded", label: "Succeeded" });
    expect(maintenanceResult("Failed")).toEqual({ reported: "Failed", result: "failed", label: "Failed" });
    expect(maintenanceResult("Skipped")).toEqual({ reported: "Skipped", result: "unknown", label: "Unknown" });
    expect(maintenanceResult(undefined)).toEqual({ result: "unknown", label: "Not reported" });
  });
});

describe("a value the reviewed release does not write", () => {
  it("is an uploader or a type of repository but kopia and restic, and one that is not set is not one", () => {
    expect([undefined, "", "kopia", "restic", "velero-x", "zfs", "Kopia"].map(writtenType)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("is a result of a maintenance with a text but Succeeded and Failed, and one not reported is not one", () => {
    expect(
      ["Succeeded", "Failed", "Skipped", undefined].map((value) => unwrittenResult(maintenanceResult(value))),
    ).toEqual([false, false, true, false]);
  });
});
