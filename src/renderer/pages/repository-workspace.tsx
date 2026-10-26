import { observer } from "mobx-react";
import { formatDuration } from "../../common/duration";
import { LEFT_OUT } from "../../common/location-view";
import { isStale } from "../../common/read-state";
import { resolveReference } from "../../common/references";
import { dueText, maintenanceDue, repositoryFrequencyText, repositoryView } from "../../common/repository-view";
import { agoText, REPOSITORY_WORDS } from "../../common/volume-words";
import { time } from "../components/status";
import styles from "../components/views.module.css";
import { FailedMaintenanceMark, RepositoryReadinessMark } from "../components/volume-status";
import { Fact, NotShown, Stale, Target, Workspace } from "../components/workspace";

import type { Maintenance } from "../../common/repository-view";
import type { BackupRepositoryResource, BackupStorageLocationResource } from "../../common/types";
import type { Installation } from "../state/installation";

export interface RepositoryWorkspaceProps {
  installation: Installation;
  name: string;
  now: number;
  back: string;
  onBack: () => void;
}

// A text that may have had an address shortened, with what was left out said beside it.
function shown(text: { value: string; shortened: boolean } | undefined): string | undefined {
  if (!text) return undefined;
  return text.shortened ? `${text.value} ${LEFT_OUT}` : text.value;
}

function MaintenanceRow({ maintenance }: { maintenance: Maintenance }) {
  const { result } = maintenance;

  return (
    <tr data-maintenance-result={result.result}>
      <td>
        <span
          className={`${styles.status} ${result.result === "failed" ? styles.signalFailure : ""}`}
          data-result={result.reported ?? "none"}
        >
          <span className={styles.statusText}>
            {result.result === "unknown" && result.reported ? `${result.label}: ${result.reported}` : result.label}
          </span>
        </span>
      </td>
      <td>{time(maintenance.started)}</td>
      <td>{time(maintenance.completed)}</td>
      <td>
        {maintenance.milliseconds === undefined
          ? REPOSITORY_WORDS.noDuration
          : formatDuration(maintenance.milliseconds)}
      </td>
      <td>{shown(maintenance.message) ?? ""}</td>
    </tr>
  );
}

// One backup repository, read only: whether Velero can use it and why not, when it was last maintained and when the
// next maintenance is due by the clock of this machine, what it is of, and its recent maintenances. Nothing of it is
// a verdict on the backups it holds.
export const RepositoryWorkspace = observer(({ installation, name, now, back, onBack }: RepositoryWorkspaceProps) => {
  const namespace = installation.namespace ?? "";
  const read = installation.read("backupRepositories");
  const repository = (read.items as BackupRepositoryResource[]).find((item) => item.metadata.name === name);

  if (!repository) {
    return (
      <Workspace kind="backup-repository" name={name} back={back} onBack={onBack}>
        <NotShown kind="backup-repository" namespace={namespace} read={read} />
      </Workspace>
    );
  }
  const view = repositoryView(repository);
  const locations = installation.read("storageLocations");
  const location = view.location
    ? (locations.items as BackupStorageLocationResource[]).find((item) => item.metadata.name === view.location)
    : undefined;
  const readOnly = location?.spec?.accessMode === "ReadOnly";
  const due = maintenanceDue(view, now, readOnly);

  return (
    <Workspace kind="backup-repository" name={view.name} uid={view.uid} back={back} onBack={onBack}>
      <div className={styles.band} data-testid="velero-backup-repository-status">
        <Fact name="Readiness" note={shown(view.message)}>
          <RepositoryReadinessMark readiness={view.readiness} message={view.message?.value} />
        </Fact>
        <Fact
          name="Last maintenance"
          note={
            view.newestFailed ? `The ${REPOSITORY_WORDS.newestFailed}: ${REPOSITORY_WORDS.lastSucceeded}.` : undefined
          }
        >
          <span data-testid="velero-backup-repository-maintained" data-newest-failed={view.newestFailed}>
            {view.lastMaintenance === undefined
              ? REPOSITORY_WORDS.neverMaintained
              : `${time(view.lastMaintenance)} (${agoText(now - view.lastMaintenance)})`}
          </span>
          {view.newestFailed ? <FailedMaintenanceMark /> : null}
        </Fact>
        <Fact name="Next maintenance" note={`${REPOSITORY_WORDS.pass} ${REPOSITORY_WORDS.job}`}>
          <span data-testid="velero-backup-repository-due" data-due={due.state}>
            {dueText(due)}
          </span>
        </Fact>
        <Fact name="Installation" note={`Cluster ${installation.cluster.name}`}>
          {view.namespace}
        </Fact>
      </div>
      {isStale(read) ? <Stale kind="backup-repository" read={read} /> : null}
      <p className={styles.factNote} data-testid="velero-backup-repository-what">
        {REPOSITORY_WORDS.what}
      </p>

      <h3 className={styles.sectionTitle}>Repository</h3>
      <div className={styles.band} data-testid="velero-backup-repository-of">
        <Fact name="Volume namespace">{view.volumeNamespace ?? REPOSITORY_WORDS.notSet}</Fact>
        <Fact name="Storage location">
          {view.location ? (
            <Target reference={resolveReference("BackupStorageLocation", view.location, view.namespace, locations)} />
          ) : (
            REPOSITORY_WORDS.notSet
          )}
        </Fact>
        <Fact name="Type">{view.type ?? REPOSITORY_WORDS.notSet}</Fact>
        {view.resticIdentifier ? (
          <Fact name="Restic identifier" note={view.resticIdentifier.shortened ? LEFT_OUT : undefined}>
            <code data-testid="velero-backup-repository-identifier">{view.resticIdentifier.value}</code>
          </Fact>
        ) : null}
        <Fact
          name="Maintenance frequency"
          note={view.frequency.read ? formatDuration(view.frequency.milliseconds) : undefined}
        >
          {repositoryFrequencyText(view.frequency)}
        </Fact>
      </div>
      {view.config.length ? (
        <table className={styles.references} data-testid="velero-backup-repository-config">
          <tbody>
            {view.config.map((entry) => (
              <tr key={entry.key} data-config-key={entry.key}>
                <th scope="row">{entry.key}</th>
                <td>
                  <code>{entry.value}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.stateText} data-testid="velero-backup-repository-config">
          {REPOSITORY_WORDS.noConfig}
        </p>
      )}

      <h3 className={styles.sectionTitle}>Maintenance</h3>
      {view.maintenances.length ? (
        <table className={styles.references} data-testid="velero-backup-repository-maintenances">
          <thead>
            <tr>
              <th scope="col">Result</th>
              <th scope="col">Started</th>
              <th scope="col">Completed</th>
              <th scope="col">Duration</th>
              <th scope="col">Message</th>
            </tr>
          </thead>
          <tbody>
            {view.maintenances.map((maintenance, index) => (
              <MaintenanceRow key={`${maintenance.started ?? "none"}-${index}`} maintenance={maintenance} />
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.stateText} data-testid="velero-backup-repository-maintenances">
          {REPOSITORY_WORDS.noMaintenance}
        </p>
      )}
      <p className={styles.factNote}>{REPOSITORY_WORDS.job}</p>
      {readOnly ? <p className={styles.factNote}>{REPOSITORY_WORDS.readOnly}</p> : null}
    </Workspace>
  );
});
