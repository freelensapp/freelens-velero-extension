import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { ownedText, pausedText, scheduleView, zoneText } from "../../common/schedule-view";
import { time } from "../components/status";
import { currentInstallation } from "../state/context";
import { WorkspaceLink } from "./workspace-link";

import type { ScheduleResource } from "../../common/types";
import type { Schedule } from "../api/kinds";
import type { Installation } from "../state/installation";

const {
  Component: { DrawerItem, DrawerTitle },
} = Renderer;

export interface ScheduleDetailsProps extends Renderer.Component.KubeObjectDetailsProps<Schedule> {
  extension: Renderer.LensExtension;
  installation?: Installation;
}

// What the details of the host show of a Schedule, where the host opens them: the same reading of the
// object the views of the extension give, in short, and the way to the workspace, where the history is. It
// asks nothing of the cluster.
export const ScheduleDetails = observer(({ object, extension, installation }: ScheduleDetailsProps) => {
  if (!object) return null;
  const view = scheduleView(object as unknown as ScheduleResource);

  return (
    <div data-testid="velero-schedule-details">
      <DrawerTitle>Velero</DrawerTitle>
      <DrawerItem name="Validation">{view.state.label}</DrawerItem>
      <DrawerItem name="Paused">{pausedText(view.paused)}</DrawerItem>
      <DrawerItem name="Schedule">{view.expression.written ?? "Not reported"}</DrawerItem>
      <DrawerItem name="Time zone">{zoneText(view.expression.zone)}</DrawerItem>
      <DrawerItem name="Last submission">{time(view.lastSubmission)}</DrawerItem>
      <DrawerItem name="Last skipped">{time(view.lastSkipped)}</DrawerItem>
      <DrawerItem name="Backups owned by the schedule">{ownedText(view.owned)}</DrawerItem>
      <DrawerItem name="Installation">{view.namespace}</DrawerItem>
      {view.validationErrors.length ? (
        <DrawerItem name="Validation errors">{view.validationErrors.join("; ")}</DrawerItem>
      ) : null}
      {view.notes.length ? <DrawerItem name="Notes">{view.notes.join(" ")}</DrawerItem> : null}
      <WorkspaceLink
        extension={extension}
        installation={installation ?? currentInstallation()}
        target={{ kind: "schedule", name: view.name }}
        namespace={view.namespace}
      />
    </div>
  );
});
