import { Renderer } from "@freelensapp/extensions";
import { backupView, SORTING, searchFields } from "../../common/backup-view";
import { countsText, durationText, progressText, signalText } from "../../common/operation-text";
import { Backup } from "../api/kinds";
import { FamilyPage } from "../components/family-page";
import { Phase, Signal, time } from "../components/status";
import { openView } from "../navigation";
import { currentInstallation } from "../state/context";
import { CREATE_VIEW_NAME } from "./backup-create-workspace";
import { OpenView } from "./open-view";

import type { BackupView } from "../../common/backup-view";
import type { BackupResource } from "../../common/types";
import type { ListDefinition } from "../components/family-page";
import type { Installation } from "../state/installation";

const {
  Component: { Button, Icon, KubeObjectAge, WithTooltip },
} = Renderer;

export const BACKUPS: ListDefinition<BackupView> = {
  kind: "backup",
  id: "backups",
  object: Backup,
  tableId: "veleroBackupsTable",
  columns: [
    { title: "Name", id: "name", sortBy: "name", className: "name" },
    { title: "Installation", id: "namespace", sortBy: "namespace", className: "installation" },
    { title: "Phase", id: "phase", sortBy: "phase", className: "phase" },
    { title: "Failure", id: "errors", sortBy: "errors", className: "failure" },
    { title: "Item progress", id: "progress", sortBy: "progress", className: "progress" },
    { title: "Started", id: "started", sortBy: "started", className: "started" },
    { title: "Duration", id: "duration", sortBy: "duration", className: "duration" },
    { title: "Storage", id: "storage", sortBy: "storage", className: "storage" },
    { title: "Age", id: "age", sortBy: "age", className: "age" },
  ],
  view: (resource, now) => backupView(resource as BackupResource, now),
  sorting: SORTING,
  search: searchFields,
  cells: (row, item) => [
    <WithTooltip key="namespace">{row.namespace}</WithTooltip>,
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
    <WithTooltip key="storage">{row.storage ?? "Not reported"}</WithTooltip>,
    <KubeObjectAge key="age" object={item} />,
  ],
  // Create backup, the one command of the list: it opens the form, which writes nothing by itself, a new one once the
  // backup of the form before was created.
  command: (installation) => (
    <Button
      primary
      data-testid="velero-backups-create"
      onClick={() => {
        installation.backupCreate.start();
        openView({ kind: "backup-create", name: CREATE_VIEW_NAME });
      }}
    >
      <Icon material="add" small aria-hidden />
      Create backup
    </Button>
  ),
};

// The Backups of the selected installation: the list and, over it, the view of what is open.
export function BackupsPage({ installation = currentInstallation() }: { installation?: Installation }) {
  return <FamilyPage definition={BACKUPS} installation={installation} view={OpenView} />;
}
