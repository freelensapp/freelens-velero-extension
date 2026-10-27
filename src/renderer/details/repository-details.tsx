import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { repositoryView } from "../../common/repository-view";
import { writtenType } from "../../common/volume-phases";
import { agoText, REPOSITORY_WORDS } from "../../common/volume-words";
import { time } from "../components/status";
import styles from "../components/views.module.css";
import { useNow } from "../components/views-frame";
import { FailedMaintenanceMark, RepositoryReadinessMark, WrittenValue } from "../components/volume-status";
import { currentInstallation } from "../state/context";
import { WorkspaceLink } from "./workspace-link";

import type { BackupRepositoryResource } from "../../common/types";
import type { BackupRepository } from "../api/kinds";
import type { Installation } from "../state/installation";

const {
  Component: { DrawerItem, DrawerTitle },
} = Renderer;

export interface RepositoryDetailsProps extends Renderer.Component.KubeObjectDetailsProps<BackupRepository> {
  extension: Renderer.LensExtension;
  installation?: Installation;
}

// What the details of the host show of a BackupRepository, where the host opens them: its readiness and its last
// maintenance, as the views read them, and the way to the workspace. It asks nothing of the cluster. Its clock is its
// own, and ends with it.
export const RepositoryDetails = observer(({ object, extension, installation }: RepositoryDetailsProps) => {
  const now = useNow();

  if (!object) return null;
  const view = repositoryView(object as unknown as BackupRepositoryResource);

  return (
    <div data-testid="velero-backup-repository-details">
      <DrawerTitle>Velero</DrawerTitle>
      <DrawerItem name="Readiness">
        <RepositoryReadinessMark readiness={view.readiness} message={view.message?.value} />
        {view.message ? <span className={styles.messageLines}> {view.message.value}</span> : null}
      </DrawerItem>
      <DrawerItem name="Last maintenance">
        <span data-newest-failed={view.newestFailed}>
          {view.lastMaintenance === undefined
            ? REPOSITORY_WORDS.neverMaintained
            : `${time(view.lastMaintenance)} (${agoText(now - view.lastMaintenance)})`}
        </span>
        {view.newestFailed ? <FailedMaintenanceMark /> : null}
      </DrawerItem>
      <DrawerItem name="Volume namespace">{view.volumeNamespace ?? REPOSITORY_WORDS.notSet}</DrawerItem>
      <DrawerItem name="Storage location">{view.location ?? REPOSITORY_WORDS.notSet}</DrawerItem>
      <DrawerItem name="Type">
        <WrittenValue text={view.type ?? REPOSITORY_WORDS.notSet} known={writtenType(view.type)} />
      </DrawerItem>
      <DrawerItem name="Installation">{view.namespace}</DrawerItem>
      <WorkspaceLink
        extension={extension}
        installation={installation ?? currentInstallation()}
        target={{ kind: "backup-repository", name: view.name }}
        namespace={view.namespace}
      />
    </div>
  );
});
