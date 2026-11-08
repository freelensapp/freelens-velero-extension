import { observer } from "mobx-react";
import { sizeText } from "../../common/artifact-volumes";
import { LEFT_OUT, shownText } from "../../common/location-view";
import { operationState } from "../../common/phases";
import { isStale } from "../../common/read-state";
import { VIEWS } from "../../common/views";
import { OPERATION_VIEW, uploadOf } from "../../common/volume-band";
import { writtenNodeOS, writtenSnapshotType } from "../../common/volume-phases";
import { OWNER_KIND, operationClaim, operationLocation, operationRepository } from "../../common/volume-references";
import { mapEntries, unknownFields, volumeView } from "../../common/volume-view";
import {
  axesText,
  BYTES_NOTE,
  INCREMENTAL_NOTE,
  incrementalText,
  MOVER_NOTE,
  NOT_REPORTED,
  NOT_WRITTEN,
  phaseSentence,
  SNAPSHOT_SIZE_NOTE,
  spanNote,
  spanText,
  UPLOADER_NOT_SET_NOTE,
  VOLUME_WORDS,
} from "../../common/volume-words";
import { time } from "../components/status";
import styles from "../components/views.module.css";
import { Bytes, NodeLink, PodLink, VolumePhase, WrittenValue } from "../components/volume-status";
import { Fact, NotShown, Stale, Target, Workspace } from "../components/workspace";
import { volumesOf } from "../state/volumes";

import type {
  BackupResource,
  DataDownloadResource,
  DataUploadResource,
  PodVolumeBackupResource,
  PodVolumeRestoreResource,
  RestoreResource,
} from "../../common/types";
import type { VolumeKind } from "../../common/volume-phases";
import type { OperationRepository, VolumeOperation } from "../../common/volume-references";
import type { VolumeView } from "../../common/volume-view";
import type { Installation } from "../state/installation";

export interface VolumeOperationWorkspaceProps {
  volume: VolumeKind;
  installation: Installation;
  name: string;
  now: number;
  back: string;
  onBack: () => void;
}

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

// A text of the object, or nothing when it carries none.
function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

// The claim of an operation by its name and its UID, or that it names none.
function Claim({ claim }: { claim: { name?: string; uid?: string } }) {
  return (
    <span data-testid="velero-volume-claim">
      {claim.name || claim.uid
        ? [claim.name, claim.uid ? `UID ${claim.uid}` : undefined].filter(Boolean).join(", ")
        : VOLUME_WORDS.noClaim}
    </span>
  );
}

// The node of an operation, and the node whose node agent accepted a data movement when it is another one.
function Nodes({ volume, view }: { volume: VolumeKind; view: VolumeView }) {
  return (
    <>
      <Fact name="Node" note={VOLUME_WORDS.nodeNote[volume]}>
        <NodeLink name={view.node} />
      </Fact>
      {view.acceptedBy ? (
        <Fact name="Accepted by" note={VOLUME_WORDS.acceptedBy}>
          <NodeLink name={view.acceptedBy} />
        </Fact>
      ) : null}
    </>
  );
}

// The volume and the settings of a pod volume backup or a pod volume restore: the pod and the volume it is of, and the
// uploader it was made with.
function PodVolumeParts({
  volume,
  operation,
  view,
}: {
  volume: VolumeKind;
  operation: VolumeOperation;
  view: VolumeView;
}) {
  const claim = operationClaim(volume, operation);
  const pods = operation as PodVolumeBackupResource | PodVolumeRestoreResource;
  const identifier = typeof pods.spec?.repoIdentifier === "string" ? shownText(pods.spec.repoIdentifier) : undefined;
  const backup = volume === "PodVolumeBackup" ? (operation as PodVolumeBackupResource) : undefined;
  const restore = volume === "PodVolumeRestore" ? (operation as PodVolumeRestoreResource) : undefined;

  return (
    <>
      <h3 className={styles.sectionTitle}>Volume</h3>
      <div className={styles.band} data-testid="velero-volume-of">
        {/* The namespace of the pod, which for a restore is the one it was restored into, beside the source one. */}
        <Fact name="Pod namespace">{view.pod.namespace ?? NOT_REPORTED}</Fact>
        <Fact
          name="Pod"
          note={view.pod.uid ? `UID ${view.pod.uid}. ${VOLUME_WORDS.hostResolves}` : VOLUME_WORDS.hostResolves}
        >
          <PodLink pod={view.pod} />
        </Fact>
        <Fact name="Volume">{view.volume ?? NOT_REPORTED}</Fact>
        <Nodes volume={volume} view={view} />
        <Fact name="Claim">
          <Claim claim={claim} />
        </Fact>
      </div>

      <h3 className={styles.sectionTitle}>Settings</h3>
      <div className={styles.band} data-testid="velero-volume-settings">
        <Fact
          name="Uploader"
          note={view.uploader === undefined ? UPLOADER_NOT_SET_NOTE : view.mover.known ? undefined : NOT_WRITTEN.note}
        >
          <WrittenValue text={view.mover.text} known={view.mover.known} />
        </Fact>
        <Fact name="Uploader settings">
          <Entries entries={mapEntries(pods.spec?.uploaderSettings)} testId="velero-volume-uploader-settings" />
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
    </>
  );
}

// A value of the object the reviewed release may not write: as written, with the mark of what is not known when it
// does not.
function Written({ value, known }: { value: string | undefined; known: boolean }) {
  return <WrittenValue text={value ?? NOT_REPORTED} known={value === undefined || known} />;
}

// The volume and the settings of a data upload or a data download: the snapshot and the claim it moves the data of
// or into, and the data mover it was made with (SPEC-0014, the workspaces).
const DataMovementParts = observer(
  ({
    volume,
    operation,
    view,
    installation,
  }: {
    volume: "DataUpload" | "DataDownload";
    operation: VolumeOperation;
    view: VolumeView;
    installation: Installation;
  }) => {
    const claim = operationClaim(volume, operation);
    const upload = volume === "DataUpload" ? (operation as DataUploadResource) : undefined;
    const download = volume === "DataDownload" ? (operation as DataDownloadResource) : undefined;
    const movement = (upload ?? download) as DataUploadResource | DataDownloadResource;
    const source = download ? uploadOf(volumesOf(installation), download) : undefined;
    const snapshot = upload?.spec?.csiSnapshot;
    const snapshotType = text(upload?.spec?.snapshotType);
    const nodeOS = text(upload ? upload.status?.nodeOS : download?.spec?.nodeOS);

    return (
      <>
        <h3 className={styles.sectionTitle}>Volume</h3>
        <div className={styles.band} data-testid="velero-volume-of">
          {upload ? (
            <>
              <Fact name="Source namespace">{text(upload.spec?.sourceNamespace) ?? NOT_REPORTED}</Fact>
              <Fact name="Source claim">
                <Claim claim={claim} />
              </Fact>
              <Fact name="Volume snapshot" note={VOLUME_WORDS.snapshotNote}>
                <span data-testid="velero-volume-snapshot">{text(snapshot?.volumeSnapshot) ?? NOT_REPORTED}</span>
              </Fact>
              <Fact name="Snapshot class">{text(snapshot?.snapshotClass) ?? NOT_REPORTED}</Fact>
              <Fact name="Driver">{text(snapshot?.driver) ?? NOT_REPORTED}</Fact>
              <Fact name="Storage class">{text(snapshot?.storageClass) ?? NOT_REPORTED}</Fact>
            </>
          ) : (
            <>
              <Fact name="Target namespace">{text(download?.spec?.targetVolume?.namespace) ?? NOT_REPORTED}</Fact>
              <Fact name="Target claim">
                <Claim claim={claim} />
              </Fact>
              <Fact name="Volume">{text(download?.spec?.targetVolume?.pv) ?? NOT_REPORTED}</Fact>
              <Fact name="Source namespace">{text(download?.spec?.sourceNamespace) ?? NOT_REPORTED}</Fact>
              <Fact name="Snapshot ID">{text(download?.spec?.snapshotID) ?? NOT_REPORTED}</Fact>
              {source ? (
                <Fact name="Data upload" note={VOLUME_WORDS.uploadNote}>
                  <Target reference={source} />
                </Fact>
              ) : null}
            </>
          )}
          <Nodes volume={volume} view={view} />
        </div>

        <h3 className={styles.sectionTitle}>Settings</h3>
        <div className={styles.band} data-testid="velero-volume-settings">
          <Fact name="Data mover" note={view.mover.known ? MOVER_NOTE : NOT_WRITTEN.note}>
            <WrittenValue text={view.mover.text} known={view.mover.known} />
          </Fact>
          <Fact name="Data mover configuration">
            <Entries entries={mapEntries(movement.spec?.dataMoverConfig)} testId="velero-volume-mover-config" />
          </Fact>
          <Fact name="Operation timeout" note={VOLUME_WORDS.timeoutNote}>
            {text(movement.spec?.operationTimeout) ?? NOT_REPORTED}
          </Fact>
          <Fact name="Node OS" note={writtenNodeOS(nodeOS) ? undefined : NOT_WRITTEN.note}>
            <Written value={nodeOS} known={writtenNodeOS(nodeOS)} />
          </Fact>
          {upload ? (
            <>
              <Fact name="Snapshot type" note={writtenSnapshotType(snapshotType) ? undefined : NOT_WRITTEN.note}>
                <Written value={snapshotType} known={writtenSnapshotType(snapshotType)} />
              </Fact>
              <Fact name="Snapshot ID">{text(upload.status?.snapshotID) ?? NOT_REPORTED}</Fact>
              <Fact name="Path">{text(upload.status?.path) ?? NOT_REPORTED}</Fact>
              <Fact name="Data mover result" note={VOLUME_WORDS.resultNote}>
                <Entries entries={mapEntries(upload.status?.dataMoverResult)} testId="velero-volume-mover-result" />
              </Fact>
            </>
          ) : null}
          <Fact name="Cancellation" note={VOLUME_WORDS.cancelNote}>
            {operation.spec?.cancel === true ? VOLUME_WORDS.cancelAsked : VOLUME_WORDS.cancelNotAsked}
          </Fact>
        </div>
      </>
    );
  },
);

// One operation of the volumes, read only: where it is and what it moved, the backup or the restore it belongs to,
// the volume, the pod or the claim it is of, and the settings it was made with. Nothing of it can be changed from
// here, its cancellation least of all.
export const VolumeOperationWorkspace = observer(
  ({ volume, installation, name, now, back, onBack }: VolumeOperationWorkspaceProps) => {
    const kind = OPERATION_VIEW[volume];
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
    const ownerKind = OWNER_KIND[volume];
    const ownerObject =
      owner.reference?.state === "resolved"
        ? ((ownerKind === "Backup" ? backups.items : restores.items) as (BackupResource | RestoreResource)[]).find(
            (item) => item.metadata.name === owner.reference?.name,
          )
        : undefined;
    const location = operationLocation(operation, installation.read("storageLocations"));
    const repository = operationRepository(volume, operation, installation.read("backupRepositories"));
    const unknown = unknownFields(volume, operation);
    const span = view.times.span;

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
            <Fact
              name="Snapshot size"
              note={SNAPSHOT_SIZE_NOTE[volume === "DataDownload" ? "DataDownload" : "PodVolumeRestore"]}
            >
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
          <Fact
            name="Repository"
            note={
              volume === "DataUpload" || volume === "DataDownload"
                ? VOLUME_WORDS.repositoryNote.moved
                : VOLUME_WORDS.repositoryNote.pod
            }
          >
            <Repository repository={repository} />
          </Fact>
        </div>

        {volume === "DataUpload" || volume === "DataDownload" ? (
          <DataMovementParts volume={volume} operation={operation} view={view} installation={installation} />
        ) : (
          <PodVolumeParts volume={volume} operation={operation} view={view} />
        )}
        {unknown.length ? (
          <p className={styles.factNote} data-testid="velero-volume-unknown-fields">
            {VOLUME_WORDS.unknownFields(unknown)}
          </p>
        ) : null}
      </Workspace>
    );
  },
);
