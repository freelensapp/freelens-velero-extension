import { Renderer } from "@freelensapp/extensions";
import { countsText, durationText, progressText, signalText } from "../../common/operation-text";
import { RESTORE_SORTING, restoreSearchFields, restoreView, sourceText } from "../../common/restore-view";
import { Restore } from "../api/kinds";
import { FamilyPage } from "../components/family-page";
import { Phase, Signal, time } from "../components/status";
import { currentInstallation } from "../state/context";
import { OpenView } from "./open-view";

import type { RestoreView } from "../../common/restore-view";
import type { RestoreResource } from "../../common/types";
import type { ListDefinition } from "../components/family-page";
import type { Installation } from "../state/installation";

const {
  Component: { WithTooltip },
} = Renderer;

export const RESTORES: ListDefinition<RestoreView> = {
  kind: "restore",
  id: "restores",
  object: Restore,
  tableId: "veleroRestoresTable",
  columns: [
    { title: "Name", id: "name", sortBy: "name", className: "name" },
    { title: "Installation", id: "namespace", sortBy: "namespace", className: "installation" },
    { title: "Source", id: "source", sortBy: "source", className: "source" },
    { title: "Phase", id: "phase", sortBy: "phase", className: "phase" },
    { title: "Failure", id: "errors", sortBy: "errors", className: "failure" },
    { title: "Item progress", id: "progress", sortBy: "progress", className: "progress" },
    { title: "Started", id: "started", sortBy: "started", className: "started" },
    { title: "Duration", id: "duration", sortBy: "duration", className: "duration" },
  ],
  view: (resource, now) => restoreView(resource as RestoreResource, now),
  sorting: RESTORE_SORTING,
  search: restoreSearchFields,
  cells: (row) => [
    <WithTooltip key="namespace">{row.namespace}</WithTooltip>,
    <WithTooltip key="source">{sourceText(row)}</WithTooltip>,
    <Phase key="phase" state={row.state} />,
    <Signal
      key="failure"
      evidence={row.evidence}
      title={`${signalText(row.evidence)}. Errors / warnings: ${countsText(row.evidence)}`}
    />,
    <WithTooltip key="progress">{progressText(row.progress)}</WithTooltip>,
    // The time of the operator in the cell, and the one of the host, with its zone, over it.
    <WithTooltip key="started" tooltip={row.started === undefined ? undefined : new Date(row.started)}>
      {time(row.started)}
    </WithTooltip>,
    <WithTooltip key="duration">{durationText(row.duration)}</WithTooltip>,
  ],
};

// The Restores of the selected installation: the list and, over it, the view of what is open.
export function RestoresPage({ installation = currentInstallation() }: { installation?: Installation }) {
  return <FamilyPage definition={RESTORES} installation={installation} view={OpenView} />;
}
