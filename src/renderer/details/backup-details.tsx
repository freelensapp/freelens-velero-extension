import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { inTheWorkspace } from "../../common/artifact-text";
import { backupView } from "../../common/backup-view";
import {
  countsNote,
  countsText,
  durationText,
  lifecycleText,
  phaseText,
  progressText,
  signalText,
} from "../../common/operation-text";
import { time } from "../components/status";
import { currentInstallation } from "../state/context";
import { WorkspaceLink } from "./workspace-link";

import type { BackupResource } from "../../common/types";
import type { Backup } from "../api/kinds";
import type { Installation } from "../state/installation";

const {
  Component: { DrawerItem, DrawerTitle },
} = Renderer;

export interface BackupDetailsProps extends Renderer.Component.KubeObjectDetailsProps<Backup> {
  extension: Renderer.LensExtension;
  installation?: Installation;
}

// What the details of the host show of a Backup, where the host opens them: the same reading of the status
// the views of the extension give, in short, that its log, its results, its resources and its volumes are in
// the workspace, and the way there. It asks nothing of the cluster, and loads none of them.
export const BackupDetails = observer(({ object, extension, installation }: BackupDetailsProps) => {
  if (!object) return null;
  const view = backupView(object as unknown as BackupResource, Date.now());
  const counters = countsNote(view.evidence, view.state);

  return (
    <div data-testid="velero-backup-details">
      <DrawerTitle>Velero</DrawerTitle>
      <DrawerItem name="Phase">
        {phaseText(view.state)} ({lifecycleText(view.state)})
      </DrawerItem>
      <DrawerItem name="Failure">{signalText(view.evidence)}</DrawerItem>
      <DrawerItem name="Errors / warnings">
        {countsText(view.evidence)}
        {counters ? `. ${counters}` : ""}
      </DrawerItem>
      <DrawerItem name="Item progress">{progressText(view.progress)}</DrawerItem>
      <DrawerItem name="Started">{time(view.started)}</DrawerItem>
      <DrawerItem name="Duration">{durationText(view.duration)}</DrawerItem>
      <DrawerItem name="Storage location">{view.storage ?? "Not reported"}</DrawerItem>
      <DrawerItem name="Schedule">{view.schedule ?? "None"}</DrawerItem>
      <DrawerItem name="Installation">{view.namespace}</DrawerItem>
      {view.evidence.validationErrors.length ? (
        <DrawerItem name="Validation errors">{view.evidence.validationErrors.join("; ")}</DrawerItem>
      ) : null}
      {/* What Velero wrote of the backup into its storage is loaded in the workspace, by a command of each
          tab: here it is said where it is, and nothing of it is loaded. */}
      <DrawerItem name="Diagnostics">
        <span data-testid="velero-backup-details-artifacts">{inTheWorkspace("Backup")}</span>
      </DrawerItem>
      <WorkspaceLink
        extension={extension}
        installation={installation ?? currentInstallation()}
        target={{ kind: "backup", name: view.name }}
        namespace={view.namespace}
      />
    </div>
  );
});
