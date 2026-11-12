import { observer } from "mobx-react";
import { formatDuration } from "../../common/duration";
import { LEFT_OUT } from "../../common/location-view";
import { isStale } from "../../common/read-state";
import { resolveReference } from "../../common/references";
import { dueText, maintenanceDue, repositoryFrequencyText, repositoryView } from "../../common/repository-view";
import { writtenType } from "../../common/volume-phases";
import { agoText, NOT_WRITTEN, REPOSITORY_WORDS } from "../../common/volume-words";
import { time } from "../components/status";
import styles from "../components/views.module.css";
import { UsedBy } from "../components/volume-band";
import {
  FailedMaintenanceMark,
  MaintenanceResultMark,
  RepositoryReadinessMark,
  WrittenValue,
} from "../components/volume-status";
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
        <MaintenanceResultMark result={result} />
      </td>
      <td>{time(maintenance.started)}</td>
      <td>{time(maintenance.completed)}</td>
      <td>
        {maintenance.milliseconds === undefined
          ? REPOSITORY_WORDS.noDuration
          : formatDuration(maintenance.milliseconds)}
      </td>
      <td>
        <span className={styles.messageLines}>{shown(maintenance.message) ?? ""}</span>
      </td>
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
  // Not known when the location is not read, is denied or is not there: a read-only one is never maintained. Before
  // the locations are answered once, the location is not known to be any of these.
  const readOnly = location ? location.spec?.accessMode === "ReadOnly" : undefined;
  const answered =
    locations.lastSuccess !== undefined || (locations.status !== "idle" && locations.status !== "loading");
  const due = maintenanceDue(view, now, readOnly, answered);

  return (
    <Workspace kind="backup-repository" name={view.name} uid={view.uid} back={back} onBack={onBack}>
      <div className={styles.band} data-testid="velero-backup-repository-status">
        <Fact
          name="Readiness"
          note={
            view.message ? (
              <span className={styles.messageLines} data-testid="velero-repository-message">
                {shown(view.message)}
              </span>
            ) : undefined
          }
        >
          <RepositoryReadinessMark readiness={view.readiness} message={view.message?.value} />
        </Fact>
        <Fact name="Last maintenance" note={view.newestFailed ? REPOSITORY_WORDS.newestFailedNote : undefined}>
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
        <Fact name="Type" note={writtenType(view.type) ? undefined : NOT_WRITTEN.note}>
          <WrittenValue text={view.type ?? REPOSITORY_WORDS.notSet} known={writtenType(view.type)} />
        </Fact>
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

      <UsedBy installation={installation} repository={repository} />
    </Workspace>
  );
});
