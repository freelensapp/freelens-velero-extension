import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { referenceText, SNAPSHOT_PHASE_NOTE, snapshotLocationView } from "../../common/location-view";
import { Availability } from "../components/location-parts";
import { currentInstallation } from "../state/context";
import { WorkspaceLink } from "./workspace-link";

import type { VolumeSnapshotLocationResource } from "../../common/types";
import type { VolumeSnapshotLocation } from "../api/kinds";
import type { Installation } from "../state/installation";

const {
  Component: { DrawerItem, DrawerTitle },
} = Renderer;

export interface SnapshotLocationDetailsProps
  extends Renderer.Component.KubeObjectDetailsProps<VolumeSnapshotLocation> {
  extension: Renderer.LensExtension;
  installation?: Installation;
}

// What the details of the host show of a VolumeSnapshotLocation: the same reading the views give, in
// short, and the way to the workspace. It asks nothing of the cluster.
export const SnapshotLocationDetails = observer(({ object, extension, installation }: SnapshotLocationDetailsProps) => {
  if (!object) return null;
  const view = snapshotLocationView(object as unknown as VolumeSnapshotLocationResource);

  return (
    <div data-testid="velero-snapshot-location-details">
      <DrawerTitle>Velero</DrawerTitle>
      <DrawerItem name="Phase">
        <Availability state={view.phase} of="snapshot" />
      </DrawerItem>
      <DrawerItem name="Provider">{view.provider ?? "Not set"}</DrawerItem>
      <DrawerItem name="Credential">{referenceText(view.credential)}</DrawerItem>
      <DrawerItem name="Installation">{view.namespace}</DrawerItem>
      <DrawerItem name="Notes">{SNAPSHOT_PHASE_NOTE}</DrawerItem>
      <WorkspaceLink
        extension={extension}
        installation={installation ?? currentInstallation()}
        target={{ kind: "snapshot-location", name: view.name }}
        namespace={view.namespace}
      />
    </div>
  );
});
