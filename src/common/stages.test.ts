import { describe, expect, it } from "vitest";
import { operationPhases, operationState } from "./phases";
import { stageStrip } from "./stages";

describe("stage strip", () => {
  it.each(
    (["Backup", "Restore"] as const).flatMap((kind) =>
      operationPhases(kind)
        .filter((phase) => phase !== "Deleting")
        .map((phase) => [kind, phase] as const),
    ),
  )("marks one stage as the current one for %s %s", (kind, phase) => {
    const strip = stageStrip(kind, operationState(kind, phase));

    expect(strip.stages.filter((stage) => stage.current)).toHaveLength(1);
    expect(strip.note).toBeUndefined();
  });

  it("puts a backup that finalizes with errors in its stage and not among the finished ones", () => {
    const strip = stageStrip("Backup", operationState("Backup", "FinalizingPartiallyFailed"));

    expect(strip.stages.find((stage) => stage.current)?.name).toBe("Finalizing");
    expect(strip.stages.at(-1)).toEqual({ name: "Finished", current: false });
  });

  it("marks no stage for a backup that is being deleted, and says why", () => {
    const strip = stageStrip("Backup", operationState("Backup", "Deleting"));

    expect(strip.stages.some((stage) => stage.current)).toBe(false);
    expect(strip.note).toContain("being deleted");
  });

  it.each([
    ["Archived", "Archived"],
    [undefined, "No phase is reported"],
    ["", "No phase is reported"],
  ])("marks no stage for the phase %j, and says that it is unknown", (phase, text) => {
    const strip = stageStrip("Backup", operationState("Backup", phase));

    expect(strip.stages.some((stage) => stage.current)).toBe(false);
    expect(strip.note).toContain(text);
    expect(strip.note).toContain("unknown");
  });

  it("has no queue among the stages of a restore", () => {
    expect(stageStrip("Restore", operationState("Restore", "New")).stages.map((stage) => stage.name)).toEqual([
      "New",
      "In progress",
      "Plugin operations",
      "Finalizing",
      "Finished",
    ]);
    expect(stageStrip("Restore", operationState("Restore", "Queued")).stages.some((stage) => stage.current)).toBe(
      false,
    );
  });
});
