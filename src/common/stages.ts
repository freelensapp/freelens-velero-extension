import type { OperationKind, OperationState } from "./phases";

// The stages an operation goes through, in their order, to show where it is now. The strip marks the
// current one and says nothing of when the others were: the object does not report it.
const STAGES: Record<OperationKind, { name: string; phases: string[] }[]> = {
  Backup: [
    { name: "New", phases: ["New"] },
    { name: "Queued", phases: ["Queued", "ReadyToStart"] },
    { name: "In progress", phases: ["InProgress"] },
    {
      name: "Plugin operations",
      phases: ["WaitingForPluginOperations", "WaitingForPluginOperationsPartiallyFailed"],
    },
    { name: "Finalizing", phases: ["Finalizing", "FinalizingPartiallyFailed"] },
    { name: "Finished", phases: ["Completed", "PartiallyFailed", "Failed", "FailedValidation"] },
  ],
  Restore: [
    { name: "New", phases: ["New"] },
    { name: "In progress", phases: ["InProgress"] },
    {
      name: "Plugin operations",
      phases: ["WaitingForPluginOperations", "WaitingForPluginOperationsPartiallyFailed"],
    },
    { name: "Finalizing", phases: ["Finalizing", "FinalizingPartiallyFailed"] },
    { name: "Finished", phases: ["Completed", "PartiallyFailed", "Failed", "FailedValidation"] },
  ],
};

export interface Stage {
  name: string;
  current: boolean;
}

export interface StageStrip {
  stages: Stage[];
  // What to say when no stage is the current one.
  note?: string;
}

export function stageStrip(kind: OperationKind, state: OperationState): StageStrip {
  const stages = STAGES[kind].map((stage) => ({
    name: stage.name,
    current: state.recognized && stage.phases.includes(state.reported ?? ""),
  }));

  if (stages.some((stage) => stage.current)) return { stages };
  if (state.lifecycle === "deleting") {
    return { stages, note: "The backup is being deleted. What it was before is not reported any more." };
  }
  return {
    stages,
    note: state.reported
      ? `The phase ${state.reported} is not one this version knows: the stage is unknown.`
      : "No phase is reported: the stage is unknown.",
  };
}
