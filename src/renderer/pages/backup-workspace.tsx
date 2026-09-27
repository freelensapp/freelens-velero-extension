import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import {
  backupView,
  countsSentence,
  countsText,
  durationText,
  lifecycleText,
  progressText,
} from "../../common/backup-view";
import { operationState } from "../../common/phases";
import { isStale } from "../../common/read-state";
import { backupReferences } from "../../common/references";
import { stageStrip } from "../../common/stages";
import { Phase, Signal, time } from "../components/status";
import styles from "../components/views.module.css";

import type { ReactNode } from "react";

import type { Reference, RelatedRestores } from "../../common/references";
import type {
  BackupResource,
  BackupStorageLocationResource,
  RestoreResource,
  ScheduleResource,
  VolumeSnapshotLocationResource,
} from "../../common/types";
import type { Installation } from "../state/installation";

const {
  Component: { Icon, Spinner },
} = Renderer;

function Fact({ name, note, children }: { name: string; note?: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <div className={styles.factName}>{name}</div>
      <div className={styles.factValue}>{children}</div>
      {note ? <div className={styles.factNote}>{note}</div> : null}
    </div>
  );
}

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

// A reference is a name with what is known of its target. It is never a link to something that may not be
// there: where the target cannot be opened, the reason is beside the name.
function Target({ reference, children }: { reference: Reference; children?: ReactNode }) {
  return (
    <span data-reference={reference.state} data-testid={`velero-reference-${reference.kind}-${reference.name}`}>
      {reference.name}
      {reference.state === "resolved" ? children : null}
      {reference.reason ? <span className={styles.muted}> ({reference.reason})</span> : null}
    </span>
  );
}

function Restores({ restores }: { restores: RelatedRestores }) {
  if (restores.state !== "listed") {
    return (
      <span className={styles.muted} data-reference={restores.state} data-testid="velero-related-restores">
        {restores.reason}
      </span>
    );
  }
  if (!restores.items.length) {
    return (
      <span data-reference="listed" data-testid="velero-related-restores">
        None{restores.stale ? " in what was read before the restores stopped answering" : ""}
      </span>
    );
  }
  return (
    <span data-reference="listed" data-testid="velero-related-restores">
      {restores.items.map((restore: RestoreResource, index) => (
        <span key={restore.metadata.uid ?? restore.metadata.name}>
          {index ? ", " : ""}
          {restore.metadata.name} ({operationState("Restore", restore.status?.phase).label})
        </span>
      ))}
      {restores.stale ? <span className={styles.muted}> (read before the restores stopped answering)</span> : null}
    </span>
  );
}

export interface BackupWorkspaceProps {
  installation: Installation;
  name: string;
  now: number;
  onBack: () => void;
}

// One backup, read only: where it is, what it says of a failure, what it was asked to include and what it
// refers to. Nothing here asks Velero for a log or a result: that is a request, and a request is a write.
export const BackupWorkspace = observer(({ installation, name, now, onBack }: BackupWorkspaceProps) => {
  const namespace = installation.namespace ?? "";
  const read = installation.read("backups");
  const backup = (read.items as BackupResource[]).find((item) => item.metadata.name === name);
  const way = React.useRef<HTMLButtonElement>(null);
  const leave = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") onBack();
  };
  const back = (
    <button ref={way} type="button" className={styles.back} onClick={onBack} data-testid="velero-back">
      <Icon material="arrow_back" small aria-hidden />
      Backups
    </button>
  );

  // The keyboard follows the view: it starts from the way back, which Escape takes as well.
  React.useEffect(() => {
    way.current?.focus();
  }, [name]);

  if (!backup) {
    const waiting = read.status === "idle" || read.status === "loading";

    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: Escape leaves the view from wherever the focus is in it
      <div className={styles.workspace} data-testid="velero-backup-workspace" onKeyDown={leave}>
        <div className={styles.breadcrumb}>
          {back}
          <span className={styles.title}>{name}</span>
        </div>
        {waiting ? (
          <Spinner />
        ) : read.status === "ready" ? (
          <p className={styles.stateText} data-testid="velero-backup-missing">
            No backup of this name is in {namespace}. It may have been deleted, or it is of another installation.
          </p>
        ) : (
          // A list that was not read says nothing of what is in it.
          <p className={styles.stateText} data-testid="velero-backup-unknown">
            {read.status === "forbidden"
              ? `Access to the backups of ${namespace} is denied`
              : read.status === "not-served"
                ? "This cluster does not serve the backups of Velero"
                : `The backups of ${namespace} could not be read`}
            , so this one cannot be shown. It is not known to be absent.
          </p>
        )}
      </div>
    );
  }
  const view = backupView(backup, now);
  const strip = stageStrip("Backup", view.state);
  const references = backupReferences(backup, {
    schedules: installation.read("schedules") as never,
    storageLocations: installation.read("storageLocations") as never,
    snapshotLocations: installation.read("snapshotLocations") as never,
    restores: installation.read("restores") as never,
  });
  const location = references.storageLocation
    ? (installation.read("storageLocations").items as BackupStorageLocationResource[]).find(
        (item) => item.metadata.name === references.storageLocation?.name,
      )
    : undefined;
  const schedule = references.schedule
    ? (installation.read("schedules").items as ScheduleResource[]).find(
        (item) => item.metadata.name === references.schedule?.name,
      )
    : undefined;
  const snapshots = installation.read("snapshotLocations").items as VolumeSnapshotLocationResource[];
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
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape leaves the view from wherever the focus is in it
    <div
      className={styles.workspace}
      data-testid="velero-backup-workspace"
      data-backup-uid={view.uid}
      onKeyDown={leave}
    >
      <div className={styles.breadcrumb}>
        {back}
        <span className={styles.title} data-testid="velero-backup-name">
          {view.name}
        </span>
      </div>

      <div className={styles.band} data-testid="velero-backup-status">
        <Fact name="Phase" note={lifecycleText(view.state)}>
          <Phase state={view.state} />
        </Fact>
        <Fact name="Failure">
          <Signal evidence={view.evidence} />
        </Fact>
        <Fact name="Errors / warnings">{countsText(view.evidence)}</Fact>
        <Fact name="Started">{time(view.started)}</Fact>
        <Fact name={view.duration.state === "running" ? "Elapsed" : "Duration"}>{durationText(view.duration)}</Fact>
        <Fact name="Completed">{time(view.completed)}</Fact>
        <Fact name="Expires">{time(view.expires)}</Fact>
        <Fact name="Installation" note={`Cluster ${installation.cluster.name}`}>
          {view.namespace}
        </Fact>
      </div>
      {isStale(read) ? (
        <p className={styles.factNote} data-testid="velero-backup-stale">
          The backups could not be read again: this is what was read at{" "}
          {new Date(read.lastSuccess ?? 0).toLocaleTimeString()}.
        </p>
      ) : null}

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
    </div>
  );
});
