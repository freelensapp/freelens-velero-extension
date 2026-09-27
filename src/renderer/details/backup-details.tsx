import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import {
  backupView,
  countsText,
  durationText,
  lifecycleText,
  phaseText,
  progressText,
  signalText,
} from "../../common/backup-view";
import { time } from "../components/status";
import { BACKUP_PARAM, BACKUPS_PAGE_ID, pageUrl } from "../navigation";
import { currentInstallation } from "../state/context";

import type { BackupResource } from "../../common/types";
import type { Backup } from "../api/kinds";
import type { Installation } from "../state/installation";

const {
  Component: { DrawerItem, DrawerTitle, MaybeLink },
} = Renderer;

export interface BackupDetailsProps extends Renderer.Component.KubeObjectDetailsProps<Backup> {
  extension: Renderer.LensExtension;
  installation?: Installation;
}

// What the details of the host show of a Backup, where the host opens them: the same reading of the status
// the views of the extension give, in short, and the way to the workspace. It asks nothing of the cluster.
export const BackupDetails = observer(({ object, extension, installation }: BackupDetailsProps) => {
  if (!object) return null;
  const view = backupView(object as unknown as BackupResource, Date.now());
  const selected = (installation ?? currentInstallation()).selection;
  // The workspace shows the backups of the installation that is selected: a backup of another namespace
  // is not there, and a link to it would open one of the same name or none.
  const there = (selected.state === "selected" || selected.state === "stale") && selected.namespace === view.namespace;

  return (
    <div data-testid="velero-backup-details">
      <DrawerTitle>Velero</DrawerTitle>
      <DrawerItem name="Phase">
        {phaseText(view.state)} ({lifecycleText(view.state)})
      </DrawerItem>
      <DrawerItem name="Failure">{signalText(view.evidence)}</DrawerItem>
      <DrawerItem name="Errors / warnings">{countsText(view.evidence)}</DrawerItem>
      <DrawerItem name="Item progress">{progressText(view.progress)}</DrawerItem>
      <DrawerItem name="Started">{time(view.started)}</DrawerItem>
      <DrawerItem name="Duration">{durationText(view.duration)}</DrawerItem>
      <DrawerItem name="Storage location">{view.storage ?? "Not reported"}</DrawerItem>
      <DrawerItem name="Schedule">{view.schedule ?? "None"}</DrawerItem>
      <DrawerItem name="Installation">{view.namespace}</DrawerItem>
      {view.evidence.validationErrors.length ? (
        <DrawerItem name="Validation errors">{view.evidence.validationErrors.join("; ")}</DrawerItem>
      ) : null}
      <DrawerItem name="Workspace">
        {there ? (
          <MaybeLink
            to={pageUrl(extension.name, BACKUPS_PAGE_ID, { [BACKUP_PARAM]: view.name })}
            data-testid="velero-backup-details-link"
          >
            Open among the backups of Velero
          </MaybeLink>
        ) : (
          <span data-testid="velero-backup-details-elsewhere">
            Select {view.namespace} among the backups of Velero to open it there
          </span>
        )}
      </DrawerItem>
    </div>
  );
});
