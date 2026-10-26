import { observer } from "mobx-react";
import { sizeText } from "../../common/artifact-volumes";
import { LEFT_OUT, shownText } from "../../common/location-view";
import { operationState } from "../../common/phases";
import { isStale } from "../../common/read-state";
import { VIEWS } from "../../common/views";
import { operationClaim, operationLocation, operationRepository } from "../../common/volume-references";
import { mapEntries, unknownFields, volumeView } from "../../common/volume-view";
import {
  axesText,
  BYTES_NOTE,
  INCREMENTAL_NOTE,
  incrementalText,
  NOT_REPORTED,
  phaseSentence,
  SNAPSHOT_SIZE_NOTE,
  spanNote,
  spanText,
  uploaderText,
  VOLUME_WORDS,
} from "../../common/volume-words";
import { time } from "../components/status";
import styles from "../components/views.module.css";
import { Bytes, NodeLink, PodLink, VolumePhase } from "../components/volume-status";
import { Fact, NotShown, Stale, Target, Workspace } from "../components/workspace";

import type {
  BackupResource,
  PodVolumeBackupResource,
  PodVolumeRestoreResource,
  RestoreResource,
} from "../../common/types";
import type { VolumeKind } from "../../common/volume-phases";
import type { OperationRepository, VolumeOperation } from "../../common/volume-references";
import type { Installation } from "../state/installation";

export interface VolumeOperationWorkspaceProps {
  volume: VolumeKind;
  installation: Installation;
  name: string;
  now: number;
  back: string;
  onBack: () => void;
}

const VIEW_KIND = { PodVolumeBackup: "pod-volume-backup", PodVolumeRestore: "pod-volume-restore" } as const;

// The keys of a map of the operation, or that it carries none.
function Entries({ entries, testId }: { entries: { key: string; value: string }[]; testId: string }) {
  if (!entries.length) return <span data-testid={testId}>{VOLUME_WORDS.none}</span>;
  return (
    <span data-testid={testId}>
      {entries.map((entry, index) => (
        <span key={entry.key}>
          {index ? ", " : ""}
          <code>{entry.key}</code>: {entry.value}
        </span>
      ))}
    </span>
  );
}

// The repository of an operation: a way to it when one is found by the three labels, and what is known otherwise.
function Repository({ repository }: { repository: OperationRepository }) {
  if (repository.state === "found") return <Target reference={repository.reference} />;
  return (
    <span className={styles.muted} data-reference={repository.state} data-testid="velero-volume-repository">
      {repository.reason}
      {repository.names.length ? `: ${repository.names.join(", ")}` : ""}
    </span>
  );
}

// One pod volume backup or pod volume restore, read only: where it is and what it moved, the backup or the restore
// it belongs to, the volume and the pod it is of, and the settings it was made with. Nothing of it can be changed
// from here, its cancellation least of all.
export const VolumeOperationWorkspace = observer(
  ({ volume, installation, name, now, back, onBack }: VolumeOperationWorkspaceProps) => {
    const kind = VIEW_KIND[volume];
    const namespace = installation.namespace ?? "";
    const read = installation.read(VIEWS[kind].family);
    const operation = (read.items as VolumeOperation[]).find((item) => item.metadata.name === name);

    if (!operation) {
      return (
        <Workspace kind={kind} name={name} back={back} onBack={onBack}>
          <NotShown kind={kind} namespace={namespace} read={read} />
        </Workspace>
      );
    }
    const backups = installation.read("backups");
    const restores = installation.read("restores");
    const view = volumeView(volume, operation, now, { backups, restores });
    const { owner } = view;
    const ownerKind = volume === "PodVolumeBackup" ? "Backup" : "Restore";
    const ownerObject =
      owner.reference?.state === "resolved"
        ? ((ownerKind === "Backup" ? backups.items : restores.items) as (BackupResource | RestoreResource)[]).find(
            (item) => item.metadata.name === owner.reference?.name,
          )
        : undefined;
    const location = operationLocation(operation, installation.read("storageLocations"));
    const repository = operationRepository(volume, operation, installation.read("backupRepositories"));
    const claim = operationClaim(volume, operation);
    const identifier =
      typeof operation.spec?.repoIdentifier === "string" ? shownText(operation.spec.repoIdentifier) : undefined;
    const unknown = unknownFields(volume, operation);
    const span = view.times.span;
    const backup = volume === "PodVolumeBackup" ? (operation as PodVolumeBackupResource) : undefined;
    const restore = volume === "PodVolumeRestore" ? (operation as PodVolumeRestoreResource) : undefined;

    return (
      <Workspace kind={kind} name={view.name} uid={view.uid} back={back} onBack={onBack}>
        <div className={styles.band} data-testid={`velero-${kind}-status`}>
          <Fact name="Phase" note={`${axesText(view.state)}. ${phaseSentence(view.state)}`}>
            <VolumePhase state={view.state} message={view.message} />
          </Fact>
          {view.message ? (
            <Fact name="Message">
              <span className={styles.messageLines} data-testid="velero-volume-message">
                {view.message}
              </span>
            </Fact>
          ) : null}
          <Fact name="Accepted">{time(view.times.accepted)}</Fact>
          <Fact name="Started">
            {view.times.started === undefined ? VOLUME_WORDS.notStarted : time(view.times.started)}
          </Fact>
          <Fact name="Completed">{time(view.times.completed)}</Fact>
          <Fact
            name={span.state === "waiting" ? "Waiting" : span.state === "elapsed" ? "Elapsed" : "Duration"}
            note={spanNote(view.state, span)}
          >
            <span data-testid="velero-volume-span" data-span={span.state}>
              {spanText(span)}
            </span>
          </Fact>
          <Fact name="Bytes" note={BYTES_NOTE}>
            <Bytes progress={view.progress} testId="velero-volume-bytes" />
          </Fact>
          {view.incremental ? (
            <Fact name="Incremental size" note={INCREMENTAL_NOTE}>
              <span data-testid="velero-volume-incremental">{incrementalText(view.incremental.value)}</span>
            </Fact>
          ) : null}
          {view.snapshotSize ? (
            <Fact name="Snapshot size" note={SNAPSHOT_SIZE_NOTE}>
              <span data-testid="velero-volume-snapshot-size">
                {typeof view.snapshotSize.value === "number" ? sizeText(view.snapshotSize.value) : NOT_REPORTED}
              </span>
            </Fact>
          ) : null}
          <Fact name="Installation" note={`Cluster ${installation.cluster.name}`}>
            {view.namespace}
          </Fact>
        </div>
        {isStale(read) ? <Stale kind={kind} read={read} /> : null}

        <h3 className={styles.sectionTitle}>Belongs to</h3>
        <div className={styles.band} data-testid="velero-volume-belongs">
          <Fact name={ownerKind} note={owner.disagreement}>
            {owner.reference ? (
              <Target reference={owner.reference}>
                {ownerObject ? ` (${operationState(ownerKind, ownerObject.status?.phase).label})` : null}
              </Target>
            ) : (
              <span className={styles.muted}>{VOLUME_WORDS.noOwner(ownerKind.toLowerCase())}</span>
            )}
          </Fact>
          <Fact name="Storage location">{location ? <Target reference={location} /> : NOT_REPORTED}</Fact>
          <Fact name="Repository" note={VOLUME_WORDS.repositoryNote}>
            <Repository repository={repository} />
          </Fact>
        </div>

        <h3 className={styles.sectionTitle}>Volume</h3>
        <div className={styles.band} data-testid="velero-volume-of">
          <Fact
            name="Pod"
            note={view.pod.uid ? `UID ${view.pod.uid}. ${VOLUME_WORDS.hostResolves}` : VOLUME_WORDS.hostResolves}
          >
            <PodLink pod={view.pod} />
          </Fact>
          <Fact name="Volume">{view.volume ?? NOT_REPORTED}</Fact>
          <Fact name="Node" note={VOLUME_WORDS.nodeNote[volume]}>
            <NodeLink name={view.node} />
          </Fact>
          <Fact name="Claim">
            <span data-testid="velero-volume-claim">
              {claim.name || claim.uid
                ? [claim.name, claim.uid ? `UID ${claim.uid}` : undefined].filter(Boolean).join(", ")
                : VOLUME_WORDS.noClaim}
            </span>
          </Fact>
        </div>

        <h3 className={styles.sectionTitle}>Settings</h3>
        <div className={styles.band} data-testid="velero-volume-settings">
          <Fact name="Uploader">{uploaderText(view.uploader)}</Fact>
          <Fact name="Uploader settings">
            <Entries entries={mapEntries(operation.spec?.uploaderSettings)} testId="velero-volume-uploader-settings" />
          </Fact>
          <Fact name="Repository identifier" note={identifier?.shortened ? LEFT_OUT : undefined}>
            {identifier ? <code>{identifier.value}</code> : NOT_REPORTED}
          </Fact>
          {backup ? (
            <Fact name="Tags">
              <Entries entries={mapEntries(backup.spec?.tags)} testId="velero-volume-tags" />
            </Fact>
          ) : null}
          <Fact name="Snapshot ID">
            {(backup ? backup.status?.snapshotID : restore?.spec?.snapshotID) || NOT_REPORTED}
          </Fact>
          {backup ? <Fact name="Path">{backup.status?.path || NOT_REPORTED}</Fact> : null}
          {restore ? <Fact name="Source namespace">{restore.spec?.sourceNamespace || NOT_REPORTED}</Fact> : null}
          <Fact name="Cancellation" note={VOLUME_WORDS.cancelNote}>
            {operation.spec?.cancel === true ? VOLUME_WORDS.cancelAsked : VOLUME_WORDS.cancelNotAsked}
          </Fact>
        </div>
        {unknown.length ? (
          <p className={styles.factNote} data-testid="velero-volume-unknown-fields">
            {VOLUME_WORDS.unknownFields(unknown)}
          </p>
        ) : null}
      </Workspace>
    );
  },
);
