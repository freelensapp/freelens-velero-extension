import { observer } from "mobx-react";
import { backupView } from "../../common/backup-view";
import {
  countsNote,
  countsSentence,
  countsText,
  durationText,
  lifecycleText,
  progressText,
} from "../../common/operation-text";
import { isStale } from "../../common/read-state";
import { backupReferences } from "../../common/references";
import { stageStrip } from "../../common/stages";
import { Phase, Signal, time } from "../components/status";
import styles from "../components/views.module.css";
import { Fact, NotShown, Restores, Stale, Target, Workspace } from "../components/workspace";

import type { BackupResource } from "../../common/types";
import type { Installation } from "../state/installation";

function names(value: unknown, none: string): string {
  return Array.isArray(value) && value.length ? value.join(", ") : none;
}

function flag(value: unknown): string {
  return typeof value === "boolean" ? (value ? "Yes" : "No") : "Not set";
}

function selector(backup: BackupResource): string {
  const labels = backup.spec?.labelSelector?.matchLabels;
  const pairs = labels ? Object.entries(labels).map(([key, value]) => `${key}=${value}`) : [];
  const expressions = backup.spec?.labelSelector?.matchExpressions?.length ?? 0;
  const alternatives = backup.spec?.orLabelSelectors?.length ?? 0;

  return (
    [
      ...pairs,
      expressions ? `${expressions} expression${expressions === 1 ? "" : "s"}` : "",
      alternatives ? `${alternatives} alternative selector${alternatives === 1 ? "" : "s"}` : "",
    ]
      .filter(Boolean)
      .join(", ") || "None"
  );
}

export interface BackupWorkspaceProps {
  installation: Installation;
  name: string;
  now: number;
  back: string;
  onBack: () => void;
}

// One backup, read only: where it is, what it says of a failure, what it was asked to include and what it
// refers to. Nothing here asks Velero for a log or a result: that is a request, and a request is a write.
export const BackupWorkspace = observer(({ installation, name, now, back, onBack }: BackupWorkspaceProps) => {
  const namespace = installation.namespace ?? "";
  const read = installation.read("backups");
  const backup = read.items.find((item) => item.metadata.name === name);

  if (!backup) {
    return (
      <Workspace kind="backup" name={name} back={back} onBack={onBack}>
        <NotShown kind="backup" namespace={namespace} read={read} />
      </Workspace>
    );
  }
  const view = backupView(backup, now);
  const strip = stageStrip("Backup", view.state);
  const references = backupReferences(backup, {
    schedules: installation.read("schedules"),
    storageLocations: installation.read("storageLocations"),
    snapshotLocations: installation.read("snapshotLocations"),
    restores: installation.read("restores"),
  });
  const location = references.storageLocation
    ? installation
        .read("storageLocations")
        .items.find((item) => item.metadata.name === references.storageLocation?.name)
    : undefined;
  const schedule = references.schedule
    ? installation.read("schedules").items.find((item) => item.metadata.name === references.schedule?.name)
    : undefined;
  const snapshots = installation.read("snapshotLocations").items;
  const messages = [
    ...view.evidence.validationErrors.map((text) => ({ kind: "Validation error", text })),
    ...(view.evidence.failureReason ? [{ kind: "Failure reason", text: view.evidence.failureReason }] : []),
    ...view.evidence.contradictions.map((text) => ({ kind: "Contradiction", text })),
    ...view.evidence.gaps.map((text) => ({ kind: "Not reported", text })),
  ];

  const counted =
    (view.evidence.errors.reported && view.evidence.errors.value > 0) ||
    (view.evidence.warnings.reported && view.evidence.warnings.value > 0);

  return (
    <Workspace kind="backup" name={view.name} uid={view.uid} back={back} onBack={onBack}>
      <div className={styles.band} data-testid="velero-backup-status">
        <Fact name="Phase" note={lifecycleText(view.state)}>
          <Phase state={view.state} />
        </Fact>
        <Fact name="Failure">
          <Signal evidence={view.evidence} />
        </Fact>
        <Fact name="Errors / warnings" note={countsNote(view.evidence, view.state)}>
          <span data-testid="velero-backup-counts">{countsText(view.evidence)}</span>
        </Fact>
        <Fact name="Started">{time(view.started)}</Fact>
        <Fact name={view.duration.state === "running" ? "Elapsed" : "Duration"}>{durationText(view.duration)}</Fact>
        <Fact name="Completed">{time(view.completed)}</Fact>
        <Fact name="Expires">{time(view.expires)}</Fact>
        <Fact name="Installation" note={`Cluster ${installation.cluster.name}`}>
          {view.namespace}
        </Fact>
      </div>
      {isStale(read) ? <Stale kind="backup" read={read} /> : null}

      <h3 className={styles.sectionTitle}>Current stage</h3>
      <ol className={styles.stages} data-testid="velero-backup-stages">
        {strip.stages.map((stage) => (
          <li
            key={stage.name}
            className={`${styles.stage} ${stage.current ? styles.stageCurrent : ""}`}
            aria-current={stage.current ? "step" : undefined}
          >
            {stage.name}
          </li>
        ))}
      </ol>
      {strip.note ? <p className={styles.factNote}>{strip.note}</p> : null}
      <div className={styles.band}>
        <Fact
          name="Item progress"
          note={
            view.progress.state === "measured" && view.state.lifecycle === "in-flight"
              ? "The items are one part of the operation: it is finished when its phase says so."
              : undefined
          }
        >
          <span data-testid="velero-backup-progress">{progressText(view.progress)}</span>
          {view.progress.percentage !== undefined ? (
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-label="Item progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={view.progress.percentage}
            >
              <div className={styles.progressBar} style={{ width: `${view.progress.percentage}%` }} />
            </div>
          ) : null}
        </Fact>
      </div>

      {messages.length || counted ? (
        <>
          <h3 className={styles.sectionTitle}>Errors and evidence</h3>
          {messages.length ? (
            <ul className={styles.messages} data-testid="velero-backup-messages">
              {messages.map((message) => (
                <li key={`${message.kind}:${message.text}`}>
                  <strong>{message.kind}:</strong> {message.text}
                </li>
              ))}
            </ul>
          ) : null}
          {counted ? (
            <p className={styles.factNote} data-testid="velero-backup-counts-note">
              The status reports {countsSentence(view.evidence)} and does not say what they are: that is in the log and
              in the results of the backup, which this view does not ask Velero for.
            </p>
          ) : null}
        </>
      ) : null}

      <h3 className={styles.sectionTitle}>Scope</h3>
      <div className={styles.band} data-testid="velero-backup-scope">
        <Fact name="Included namespaces">{names(backup.spec?.includedNamespaces, "All")}</Fact>
        <Fact name="Excluded namespaces">{names(backup.spec?.excludedNamespaces, "None")}</Fact>
        <Fact name="Included resources">{names(backup.spec?.includedResources, "All")}</Fact>
        <Fact name="Excluded resources">{names(backup.spec?.excludedResources, "None")}</Fact>
        <Fact name="Label selector">{selector(backup)}</Fact>
        <Fact name="Cluster resources">{flag(backup.spec?.includeClusterResources)}</Fact>
        <Fact name="Volume snapshots">{flag(backup.spec?.snapshotVolumes)}</Fact>
        <Fact name="Retention">{backup.spec?.ttl || "Not set"}</Fact>
      </div>

      <h3 className={styles.sectionTitle}>References</h3>
      <table className={styles.references} data-testid="velero-backup-references">
        <tbody>
          <tr>
            <th scope="row">Schedule</th>
            <td>
              {references.schedule ? (
                <Target reference={references.schedule}>
                  {schedule ? (
                    <span className={styles.muted}>
                      {" "}
                      {schedule.spec?.schedule ?? "no cron"}
                      {schedule.spec?.paused ? ", paused" : ""}
                    </span>
                  ) : null}
                </Target>
              ) : (
                <span data-testid="velero-reference-Schedule-none">None: the backup names no schedule</span>
              )}
            </td>
          </tr>
          <tr>
            <th scope="row">Backup storage location</th>
            <td>
              {references.storageLocation ? (
                <Target reference={references.storageLocation}>
                  {location ? (
                    <span className={styles.muted}>
                      {" "}
                      {location.status?.phase ?? "availability not reported"},{" "}
                      {location.spec?.accessMode ?? "access mode not set"}
                    </span>
                  ) : null}
                </Target>
              ) : (
                <span data-testid="velero-reference-BackupStorageLocation-none">
                  Not reported: the backup names no storage location
                </span>
              )}
            </td>
          </tr>
          <tr>
            <th scope="row">Volume snapshot locations</th>
            <td>
              {references.volumeSnapshotLocations.length
                ? references.volumeSnapshotLocations.map((reference, index) => (
                    <span key={reference.name}>
                      {index ? ", " : ""}
                      <Target reference={reference}>
                        <span className={styles.muted}>
                          {" "}
                          {snapshots.find((item) => item.metadata.name === reference.name)?.status?.phase ??
                            "availability not reported"}
                        </span>
                      </Target>
                    </span>
                  ))
                : "None"}
            </td>
          </tr>
          <tr>
            <th scope="row">Restores of this backup</th>
            <td>
              <Restores restores={references.restores} />
            </td>
          </tr>
        </tbody>
      </table>
    </Workspace>
  );
});
