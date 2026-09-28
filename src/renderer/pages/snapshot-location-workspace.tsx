import { observer } from "mobx-react";
import { locationUsers } from "../../common/location-users";
import { NOT_SET, SNAPSHOT_PHASE_NOTE, snapshotLocationView } from "../../common/location-view";
import { isStale } from "../../common/read-state";
import { Availability, Configuration, SecretReference, UsedBy } from "../components/location-parts";
import { time } from "../components/status";
import styles from "../components/views.module.css";
import { Fact, NotShown, Stale, Workspace } from "../components/workspace";

import type { VolumeSnapshotLocationResource } from "../../common/types";
import type { Installation } from "../state/installation";

export interface SnapshotLocationWorkspaceProps {
  installation: Installation;
  name: string;
  now: number;
  back: string;
  onBack: () => void;
}

// One volume snapshot location, read only. The reviewed release neither writes nor checks its phase: what
// is there is shown as it is written, with the mark of what is not known, and the view says so, so that
// the operator does not look for a fault and does not read a confirmation.
export const SnapshotLocationWorkspace = observer(
  ({ installation, name, now, back, onBack }: SnapshotLocationWorkspaceProps) => {
    const namespace = installation.namespace ?? "";
    const read = installation.read("snapshotLocations");
    const location = (read.items as VolumeSnapshotLocationResource[]).find((item) => item.metadata.name === name);

    if (!location) {
      return (
        <Workspace kind="snapshot-location" name={name} back={back} onBack={onBack}>
          <NotShown kind="snapshot-location" namespace={namespace} read={read} />
        </Workspace>
      );
    }
    const view = snapshotLocationView(location);
    const users = locationUsers(
      "snapshot",
      location,
      { backups: installation.read("backups"), schedules: installation.read("schedules") },
      now,
    );

    return (
      <Workspace kind="snapshot-location" name={view.name} uid={view.uid} back={back} onBack={onBack}>
        <div className={styles.band} data-testid="velero-snapshot-location-status">
          <Fact name="Phase" note={SNAPSHOT_PHASE_NOTE}>
            <Availability state={view.phase} of="snapshot" />
          </Fact>
          <Fact name="Provider">{view.provider ?? NOT_SET}</Fact>
          <Fact name="Created">{time(view.created)}</Fact>
          <Fact name="Installation" note={`Cluster ${installation.cluster.name}`}>
            {view.namespace}
          </Fact>
        </div>
        {isStale(read) ? <Stale kind="snapshot-location" read={read} /> : null}

        <h3 className={styles.sectionTitle}>Configuration</h3>
        <Configuration entries={view.config} />

        <h3 className={styles.sectionTitle}>Credentials</h3>
        <div className={styles.band} data-testid="velero-snapshot-location-credentials">
          <SecretReference name="Credential" reference={view.credential} />
        </div>

        <h3 className={styles.sectionTitle}>Used by</h3>
        <UsedBy users={users} />
      </Workspace>
    );
  },
);
