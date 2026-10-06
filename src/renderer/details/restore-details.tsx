import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { inTheWorkspace } from "../../common/artifact-text";
import {
  countsNote,
  countsText,
  durationText,
  lifecycleText,
  phaseText,
  progressText,
  signalText,
} from "../../common/operation-text";
import { restoreView, sourceNote } from "../../common/restore-view";
import { time } from "../components/status";
import { currentInstallation } from "../state/context";
import { WorkspaceLink } from "./workspace-link";

import type { RestoreResource } from "../../common/types";
import type { Restore } from "../api/kinds";
import type { Installation } from "../state/installation";

const {
  Component: { DrawerItem, DrawerTitle },
} = Renderer;

export interface RestoreDetailsProps extends Renderer.Component.KubeObjectDetailsProps<Restore> {
  extension: Renderer.LensExtension;
  installation?: Installation;
}

// What the details of the host show of a Restore, where the host opens them: the same reading of the
// object the views of the extension give, in short, that its log, its results, its resources and its
// volumes are in the workspace, and the way there. It asks nothing of the cluster, and loads none of them.
export const RestoreDetails = observer(({ object, extension, installation }: RestoreDetailsProps) => {
  if (!object) return null;
  const view = restoreView(object as unknown as RestoreResource, Date.now());
  const note = sourceNote(view);
  const counters = countsNote(view.evidence, view.state);

  return (
    <div data-testid="velero-restore-details">
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
      <DrawerItem name="Backup">{view.backup ?? "Not reported"}</DrawerItem>
      <DrawerItem name="Schedule">{view.schedule ?? "None"}</DrawerItem>
      {note ? <DrawerItem name="Source">{note}</DrawerItem> : null}
      <DrawerItem name="Installation">{view.namespace}</DrawerItem>
      {view.evidence.validationErrors.length ? (
        <DrawerItem name="Validation errors">{view.evidence.validationErrors.join("; ")}</DrawerItem>
      ) : null}
      {/* What Velero wrote of the restore into its storage is loaded in the workspace, by a command of each
          tab: here it is said where it is, and nothing of it is loaded. */}
      <DrawerItem name="Diagnostics">
        <span data-testid="velero-restore-details-artifacts">{inTheWorkspace("Restore")}</span>
      </DrawerItem>
      <WorkspaceLink
        extension={extension}
        installation={installation ?? currentInstallation()}
        target={{ kind: "restore", name: view.name }}
        namespace={view.namespace}
      />
    </div>
  );
});
