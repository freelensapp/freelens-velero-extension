import { observer } from "mobx-react";
import { locationUsers, REFUSED_WHEN_NOT_AVAILABLE } from "../../common/location-users";
import {
  accessNote,
  defaults,
  defaultsNote,
  frequencyNote,
  frequencyText,
  LEFT_OUT,
  lateNote,
  NEVER_SYNCED,
  NEVER_VALIDATED,
  NOT_SET,
  storageLocationView,
  syncNote,
  syncSummary,
  syncText,
  validationAge,
} from "../../common/location-view";
import { isStale } from "../../common/read-state";
import { Availability, Configuration, SecretReference, UsedBy } from "../components/location-parts";
import { time } from "../components/status";
import styles from "../components/views.module.css";
import { Fact, NotShown, Stale, Workspace } from "../components/workspace";

import type { BackupStorageLocationResource } from "../../common/types";
import type { Installation } from "../state/installation";

export interface StorageLocationWorkspaceProps {
  installation: Installation;
  name: string;
  now: number;
  back: string;
  onBack: () => void;
}

// One backup storage location, read only: whether Velero reports it available and when it last looked,
// whether it takes new backups, whether it is marked default, where it points, and what uses it. The three
// facts are apart, and a location that reports nothing is not shown as one that is well.
export const StorageLocationWorkspace = observer(
  ({ installation, name, now, back, onBack }: StorageLocationWorkspaceProps) => {
    const namespace = installation.namespace ?? "";
    const read = installation.read("storageLocations");
    const location = (read.items as BackupStorageLocationResource[]).find((item) => item.metadata.name === name);

    if (!location) {
      return (
        <Workspace kind="storage-location" name={name} back={back} onBack={onBack}>
          <NotShown kind="storage-location" namespace={namespace} read={read} />
        </Workspace>
      );
    }
    const view = storageLocationView(location, now);
    const marked = defaults(read.items as BackupStorageLocationResource[], namespace);
    const users = locationUsers(
      "storage",
      location,
      { backups: installation.read("backups"), schedules: installation.read("schedules") },
      now,
      marked,
    );
    const late = lateNote(view.validation);
    const inline = view.certificate.inline;

    return (
      <Workspace kind="storage-location" name={view.name} uid={view.uid} back={back} onBack={onBack}>
        <div className={styles.band} data-testid="velero-storage-location-status">
          <Fact
            name="Availability"
            note={
              view.message === undefined
                ? undefined
                : view.messageShortened
                  ? `${view.message} ${LEFT_OUT}`
                  : view.message
            }
          >
            <Availability state={view.availability} of="storage" />
          </Fact>
          <Fact name="Last validation" note={late || undefined}>
            <span data-testid="velero-location-validation" data-late={view.validation.late}>
              {view.validation.at === undefined
                ? NEVER_VALIDATED
                : `${time(view.validation.at)} (${validationAge(view.validation)})`}
            </span>
          </Fact>
          <Fact name="Access mode" note={accessNote(view.access, view.availability) || undefined}>
            <span data-access={view.access.mode}>{view.access.label}</span>
          </Fact>
          <Fact name="Default" note={marked.state === "one" ? undefined : defaultsNote(marked)}>
            <span data-default={view.marked}>{view.marked ? "Marked default" : "Not marked"}</span>
          </Fact>
          <Fact name="Last sync">
            <span data-testid="velero-location-synced">
              {view.sync.last === undefined ? NEVER_SYNCED : `${time(view.sync.last)} (${syncSummary(view.sync)})`}
            </span>
          </Fact>
          <Fact name="Created">{time(view.created)}</Fact>
          <Fact name="Installation" note={`Cluster ${installation.cluster.name}`}>
            {view.namespace}
          </Fact>
        </div>
        {isStale(read) ? <Stale kind="storage-location" read={read} /> : null}

        <h3 className={styles.sectionTitle}>Storage</h3>
        <div className={styles.band} data-testid="velero-storage-location-storage">
          <Fact name="Provider">{view.provider ?? NOT_SET}</Fact>
          <Fact name="Bucket">{view.bucket ?? NOT_SET}</Fact>
          <Fact name="Prefix">{view.prefix ?? NOT_SET}</Fact>
          <Fact name="Validation frequency" note={frequencyNote(view.validation.frequency) || undefined}>
            <span data-frequency={view.validation.frequency.of}>{frequencyText(view.validation.frequency)}</span>
          </Fact>
          <Fact name="Sync period" note={syncNote(view.sync) || undefined}>
            {syncText(view.sync)}
          </Fact>
        </div>
        <Configuration entries={view.config} />

        <h3 className={styles.sectionTitle}>Credentials</h3>
        <div className={styles.band} data-testid="velero-storage-location-credentials">
          <SecretReference name="Credential" reference={view.credential} />
          <SecretReference name="Certificate" reference={view.certificate.reference} />
          {inline ? (
            <Fact
              name="Certificate in the object"
              note="A certificate written in the location is deprecated in the reviewed release. Its content is not shown."
            >
              <span data-testid="velero-location-inline-certificate">
                {inline.bytes === undefined ? "Present" : `Present, ${inline.bytes} bytes`}
              </span>
            </Fact>
          ) : null}
        </div>

        <h3 className={styles.sectionTitle}>Used by</h3>
        {view.availability.availability === "available" ? null : (
          <p className={styles.factNote} role="note" data-testid="velero-location-refused">
            {REFUSED_WHEN_NOT_AVAILABLE}
          </p>
        )}
        <UsedBy users={users} />
      </Workspace>
    );
  },
);
