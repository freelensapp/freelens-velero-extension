import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import {
  accessNote,
  frequencyText,
  lateNote,
  NEVER_SYNCED,
  NEVER_VALIDATED,
  storageLocationView,
  syncSummary,
  syncText,
  validationAge,
} from "../../common/location-view";
import { useNow } from "../components/family-page";
import { Availability } from "../components/location-parts";
import { time } from "../components/status";
import { currentInstallation } from "../state/context";
import { WorkspaceLink } from "./workspace-link";

import type { BackupStorageLocationResource } from "../../common/types";
import type { BackupStorageLocation } from "../api/kinds";
import type { Installation } from "../state/installation";

const {
  Component: { DrawerItem, DrawerTitle },
} = Renderer;

export interface StorageLocationDetailsProps extends Renderer.Component.KubeObjectDetailsProps<BackupStorageLocation> {
  extension: Renderer.LensExtension;
  installation?: Installation;
}

// What the details of the host show of a BackupStorageLocation, where the host opens them: the same
// reading of the object the views of the extension give, in short, and the way to the workspace, where
// what uses the location is. It asks nothing of the cluster.
export const StorageLocationDetails = observer(({ object, extension, installation }: StorageLocationDetailsProps) => {
  const now = useNow();

  if (!object) return null;
  const view = storageLocationView(object as unknown as BackupStorageLocationResource, now);
  const notes = [lateNote(view.validation), accessNote(view.access, view.availability)].filter(Boolean);

  return (
    <div data-testid="velero-storage-location-details">
      <DrawerTitle>Velero</DrawerTitle>
      <DrawerItem name="Availability">
        <Availability state={view.availability} of="storage" />
      </DrawerItem>
      {view.message ? <DrawerItem name="Message">{view.message}</DrawerItem> : null}
      <DrawerItem name="Last validation">
        {view.validation.at === undefined
          ? NEVER_VALIDATED
          : `${time(view.validation.at)} (${validationAge(view.validation)})`}
      </DrawerItem>
      <DrawerItem name="Validation frequency">{frequencyText(view.validation.frequency)}</DrawerItem>
      <DrawerItem name="Access mode">{view.access.label}</DrawerItem>
      <DrawerItem name="Default">{view.marked ? "Marked default" : "Not marked"}</DrawerItem>
      <DrawerItem name="Last sync">
        {view.sync.last === undefined ? NEVER_SYNCED : `${time(view.sync.last)} (${syncSummary(view.sync)})`}
      </DrawerItem>
      <DrawerItem name="Sync period">{syncText(view.sync)}</DrawerItem>
      <DrawerItem name="Installation">{view.namespace}</DrawerItem>
      {notes.length ? <DrawerItem name="Notes">{notes.join(" ")}</DrawerItem> : null}
      <WorkspaceLink
        extension={extension}
        installation={installation ?? currentInstallation()}
        target={{ kind: "storage-location", name: view.name }}
        namespace={view.namespace}
      />
    </div>
  );
});
