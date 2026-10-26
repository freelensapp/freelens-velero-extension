import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { volumeView } from "../../common/volume-view";
import { agoText, axesText, bytesText, spanText, VOLUME_WORDS, volumePhaseText } from "../../common/volume-words";
import { useNow } from "../components/views-frame";
import { NodeLink } from "../components/volume-status";
import { currentInstallation } from "../state/context";
import { READ_EVERY } from "../state/installation";
import { WorkspaceLink } from "./workspace-link";

import type { VolumeKind } from "../../common/volume-phases";
import type { VolumeOperation } from "../../common/volume-references";
import type { PodVolumeBackup, PodVolumeRestore } from "../api/kinds";
import type { Installation } from "../state/installation";

const {
  Component: { DrawerItem, DrawerTitle },
} = Renderer;

export interface VolumeOperationDetailsProps
  extends Renderer.Component.KubeObjectDetailsProps<PodVolumeBackup | PodVolumeRestore> {
  volume: VolumeKind;
  extension: Renderer.LensExtension;
  installation?: Installation;
}

const OF = {
  PodVolumeBackup: { kind: "pod-volume-backup", owner: "backups", noun: "Backup" },
  PodVolumeRestore: { kind: "pod-volume-restore", owner: "restores", noun: "Restore" },
} as const;

// What the details of the host show of a PodVolumeBackup or a PodVolumeRestore, where the host opens them: the same
// reading of the object the views give, in short, and the way to the workspace. It asks nothing of the cluster and
// holds no family: the backup or the restore it belongs to is found among what the views last read of the
// installation of its namespace, with how old that read is when no view keeps it fresh. Its clock is its own, and
// ends with it.
export const VolumeOperationDetails = observer(
  ({ object, volume, extension, installation }: VolumeOperationDetailsProps) => {
    const now = useNow();

    if (!object) return null;
    const shown = installation ?? currentInstallation();
    const operation = object as unknown as VolumeOperation;
    const namespace = operation.metadata.namespace ?? "";
    const { kind, owner, noun } = OF[volume];
    const ours = shown.namespace === namespace;
    const owners = shown.read(owner);
    const view = volumeView(volume, operation, now, {
      backups: ours ? shown.read("backups") : { status: "idle", items: [] },
      restores: ours ? shown.read("restores") : { status: "idle", items: [] },
    });
    const reference = view.owner.reference;
    const age =
      ours && owners.lastSuccess !== undefined && (!shown.watched || now - owners.lastSuccess > READ_EVERY)
        ? VOLUME_WORDS.readOfTheViews(owner, agoText(now - owners.lastSuccess), !shown.watched)
        : undefined;

    return (
      <div data-testid={`velero-${kind}-details`}>
        <DrawerTitle>Velero</DrawerTitle>
        <DrawerItem name="Phase">
          {volumePhaseText(view.state)} ({axesText(view.state)})
        </DrawerItem>
        {view.message ? <DrawerItem name="Message">{view.message}</DrawerItem> : null}
        <DrawerItem name="Progress">{bytesText(view.progress)}</DrawerItem>
        <DrawerItem name="Duration">{spanText(view.times.span)}</DrawerItem>
        <DrawerItem name={noun}>
          <span data-testid={`velero-${kind}-details-owner`} data-reference={reference?.state ?? "none"}>
            {reference
              ? [reference.name, ours ? reference.reason : VOLUME_WORDS.otherInstallation(owner), age]
                  .filter(Boolean)
                  .join(". ")
              : VOLUME_WORDS.noOwner(noun.toLowerCase())}
          </span>
        </DrawerItem>
        <DrawerItem name="Node">
          <NodeLink name={view.node} />
        </DrawerItem>
        <DrawerItem name="Installation">{view.namespace}</DrawerItem>
        <WorkspaceLink
          extension={extension}
          installation={shown}
          target={{ kind, name: view.name }}
          namespace={view.namespace}
        />
      </div>
    );
  },
);
