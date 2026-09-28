import { observer } from "mobx-react";
import { counting } from "../../common/evidence";
import {
  countsNote,
  countsSentence,
  countsText,
  durationText,
  lifecycleText,
  progressText,
} from "../../common/operation-text";
import { isStale } from "../../common/read-state";
import { restoreReferences } from "../../common/references";
import {
  countText,
  MAPPING_NOT_SET,
  MAPPING_OF_THE_REST,
  namespaceMappings,
  restoreScope,
  restoreView,
  sourceNote,
} from "../../common/restore-view";
import { stageStrip } from "../../common/stages";
import { Phase, Signal, time } from "../components/status";
import styles from "../components/views.module.css";
import { Fact, NotShown, Stale, Target, Workspace } from "../components/workspace";

import type { Installation } from "../state/installation";

export interface RestoreWorkspaceProps {
  installation: Installation;
  name: string;
  now: number;
  back: string;
  onBack: () => void;
}

// One restore, read only: where it is, what it says of a failure, where it comes from, what it restores and
// into where. Nothing here asks Velero for a log or a result: that is a request, and a request is a write.
// A restore that completed is said completed: whether what it restored works is not in the object.
export const RestoreWorkspace = observer(({ installation, name, now, back, onBack }: RestoreWorkspaceProps) => {
  const namespace = installation.namespace ?? "";
  const read = installation.read("restores");
  const restore = read.items.find((item) => item.metadata.name === name);

  if (!restore) {
    return (
      <Workspace kind="restore" name={name} back={back} onBack={onBack}>
        <NotShown kind="restore" namespace={namespace} read={read} />
      </Workspace>
    );
  }
  const view = restoreView(restore, now);
  const strip = stageStrip("Restore", view.state);
  const references = restoreReferences(restore, {
    backups: installation.read("backups"),
    schedules: installation.read("schedules"),
    storageLocations: installation.read("storageLocations"),
  });
  const location = references.storageLocation
    ? installation
        .read("storageLocations")
        .items.find((item) => item.metadata.name === references.storageLocation?.name)
    : undefined;
  const mappings = namespaceMappings(restore);
  const messages = [
    ...view.evidence.validationErrors.map((text) => ({ kind: "Validation error", text })),
    ...(view.evidence.failureReason ? [{ kind: "Failure reason", text: view.evidence.failureReason }] : []),
    ...view.evidence.contradictions.map((text) => ({ kind: "Contradiction", text })),
    ...view.evidence.gaps.map((text) => ({ kind: "Not reported", text })),
  ];
  const counted =
    (view.evidence.errors.reported && view.evidence.errors.value > 0) ||
    (view.evidence.warnings.reported && view.evidence.warnings.value > 0);
  // The release writes no counter of zero: hooks and item operations have a line when one was counted.
  const hooks = counting(view.hooks);
  const operations = counting(view.operations);
  const note = sourceNote(view);

  return (
    <Workspace kind="restore" name={view.name} uid={view.uid} deleting={view.deleting} back={back} onBack={onBack}>
      <div className={styles.band} data-testid="velero-restore-status">
        <Fact name="Phase" note={lifecycleText(view.state)}>
          <Phase state={view.state} />
        </Fact>
        <Fact name="Failure">
          <Signal evidence={view.evidence} />
        </Fact>
        <Fact name="Errors / warnings" note={countsNote(view.evidence, view.state)}>
          <span data-testid="velero-restore-counts">{countsText(view.evidence)}</span>
        </Fact>
        <Fact name="Started">{time(view.started)}</Fact>
        <Fact name={view.duration.state === "running" ? "Elapsed" : "Duration"}>{durationText(view.duration)}</Fact>
        <Fact name="Completed">{time(view.completed)}</Fact>
        <Fact name="Installation" note={`Cluster ${installation.cluster.name}`}>
          {view.namespace}
        </Fact>
      </div>
      {isStale(read) ? <Stale kind="restore" read={read} /> : null}

      <h3 className={styles.sectionTitle}>Current stage</h3>
      <ol className={styles.stages} data-testid="velero-restore-stages">
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
          <span data-testid="velero-restore-progress">{progressText(view.progress)}</span>
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
        {hooks ? (
          <Fact name="Hooks attempted / failed">
            <span data-testid="velero-restore-hooks">
              {countText(view.hooks.attempted)} / {countText(view.hooks.failed)}
            </span>
          </Fact>
        ) : null}
        {operations ? (
          <Fact name="Item operations attempted / completed / failed">
            <span data-testid="velero-restore-operations">
              {countText(view.operations.attempted)} / {countText(view.operations.completed)} /{" "}
              {countText(view.operations.failed)}
            </span>
          </Fact>
        ) : null}
      </div>
      {view.state.lifecycle === "terminal" && view.state.failure === "none" ? (
        <p className={styles.factNote} data-testid="velero-restore-completed-note">
          Completed is what Velero reports of the restore. Whether what was restored works is not in the object.
        </p>
      ) : null}

      {messages.length || counted ? (
        <>
          <h3 className={styles.sectionTitle}>Errors and evidence</h3>
          {messages.length ? (
            <ul className={styles.messages} data-testid="velero-restore-messages">
              {messages.map((message) => (
                <li key={`${message.kind}:${message.text}`}>
                  <strong>{message.kind}:</strong> {message.text}
                </li>
              ))}
            </ul>
          ) : null}
          {counted ? (
            <p className={styles.factNote} data-testid="velero-restore-counts-note">
              The status reports {countsSentence(view.evidence)} and does not say what they are: that is in the log and
              in the results of the restore, which this view does not ask Velero for.
            </p>
          ) : null}
        </>
      ) : null}

      <h3 className={styles.sectionTitle}>Source</h3>
      <table className={styles.references} data-testid="velero-restore-source">
        <tbody>
          <tr>
            <th scope="row">Backup</th>
            <td>
              {references.backup ? (
                <Target reference={references.backup} />
              ) : (
                <span data-testid="velero-reference-Backup-none">Not reported: the object names no backup</span>
              )}
            </td>
          </tr>
          <tr>
            <th scope="row">Schedule</th>
            <td>
              {references.schedule ? (
                <Target reference={references.schedule} />
              ) : (
                <span data-testid="velero-reference-Schedule-none">None: the object names no schedule</span>
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
                <span className={styles.muted} data-testid="velero-reference-BackupStorageLocation-none">
                  {/* The location is of the backup: what is known of it follows what is known of the backup. */}
                  {!references.backup
                    ? "Not known: the object names no backup, and the location is the one of the backup"
                    : references.backup.state === "resolved"
                      ? "Not reported: the backup names no storage location"
                      : "Known through the backup, which is not among what was read"}
                </span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      {note ? (
        <p className={styles.factNote} data-testid="velero-restore-source-note">
          {note}
        </p>
      ) : null}

      <h3 className={styles.sectionTitle}>Into</h3>
      {mappings.length ? (
        <>
          <table className={styles.references} data-testid="velero-restore-mappings">
            <thead>
              <tr>
                <th scope="col">Namespace of the backup</th>
                <th scope="col">Restored into</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => (
                <tr key={mapping.from} data-mapping={mapping.from}>
                  <td>{mapping.from}</td>
                  <td>{mapping.into}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.factNote} data-testid="velero-restore-mappings-rest">
            {MAPPING_OF_THE_REST}
          </p>
        </>
      ) : (
        <p className={styles.stateText} data-testid="velero-restore-mappings-none">
          {MAPPING_NOT_SET}
        </p>
      )}

      <h3 className={styles.sectionTitle}>Scope</h3>
      <div className={styles.band} data-testid="velero-restore-scope">
        {restoreScope(restore).map((fact) => (
          <Fact key={fact.id} name={fact.name} note={fact.note}>
            <span data-scope={fact.id}>{fact.value}</span>
          </Fact>
        ))}
      </div>
    </Workspace>
  );
});
