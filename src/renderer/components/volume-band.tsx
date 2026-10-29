import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { bytesProgress } from "../../common/progress";
import { isStale } from "../../common/read-state";
import { VIEWS } from "../../common/views";
import { backupBand, OPERATION_VIEW, PAGE, repositoryUses, restoreBand } from "../../common/volume-band";
import { volumeOperationState } from "../../common/volume-phases";
import { operationNode, operationPod } from "../../common/volume-references";
import { BAND_WORDS, NOT_REPORTED, POD_NOT_NAMED, USED_BY_WORDS } from "../../common/volume-words";
import { openView } from "../navigation";
import { volumesOf } from "../state/volumes";
import styles from "./views.module.css";
import { Bytes, NodeCell, VolumePhaseCell, volumePhaseIcon } from "./volume-status";
import { Target } from "./workspace";

import type { OperationKind, OperationState } from "../../common/phases";
import type { FamilyRead } from "../../common/read-state";
import type { Reference } from "../../common/references";
import type { BackupRepositoryResource, BackupResource, RestoreResource } from "../../common/types";
import type { PhaseGroup, VolumeHalf } from "../../common/volume-band";
import type { VolumeKind, VolumeOperationState } from "../../common/volume-phases";
import type { VolumeOperation } from "../../common/volume-references";
import type { Installation } from "../state/installation";

const {
  Component: { Icon, LinkToPod, WithTooltip },
} = Renderer;

// What a half says of the read of its family when it has no rows to show: being read, once; denied, failed or not
// served with no count; not read yet. A family read now, or before, has its rows.
export type HalfState = "rows" | "loading" | "denied" | "failed" | "not-served" | "not-read";

export function halfState(read: FamilyRead<unknown>): HalfState {
  if (read.status === "ready" || read.lastSuccess !== undefined) return "rows";
  if (read.status === "loading") return "loading";
  if (read.status === "idle") return "not-read";
  return read.status === "forbidden" ? "denied" : read.status;
}

const OWNER_NOUN: Record<VolumeKind, string> = { PodVolumeBackup: "backup", PodVolumeRestore: "restore" };

function plural(kind: VolumeKind): string {
  return VIEWS[OPERATION_VIEW[kind]].plural;
}

function noun(kind: VolumeKind): string {
  return VIEWS[OPERATION_VIEW[kind]].noun;
}

// The counts of the phases, each with its mark and its label, in the groups of the release.
function Groups({ kind, groups }: { kind: VolumeKind; groups: PhaseGroup[] }) {
  return (
    <ul className={styles.named} aria-label={BAND_WORDS.groups(plural(kind))} data-testid="velero-volume-groups">
      {groups.map((group) => (
        <li key={group.phase} data-phase={group.phase} data-count={group.count}>
          <GroupMark state={group.state} />
          <span>
            {group.label}: {group.count}
          </span>
        </li>
      ))}
    </ul>
  );
}

// The mark of a group, the shape of its phase, in the colour of a failure or of what is not known as the phase of a
// row is.
function GroupMark({ state }: { state: VolumeOperationState }) {
  const colour =
    state.outcome === "failed" ? styles.signalFailure : state.outcome === "unknown" ? styles.signalUnknown : "";

  return (
    <span className={`${styles.status} ${colour}`} data-outcome={state.outcome}>
      <Icon material={volumePhaseIcon(state)} small aria-hidden />
    </span>
  );
}

// The rows of a half, ten at a time, from the newest: each the pod and the volume, the phase, the bytes and the node,
// the volume a way to the view of the operation, which returns to where it was opened from.
function Rows({ kind, operations }: { kind: VolumeKind; operations: readonly VolumeOperation[] }) {
  const { shown, more, within } = usePages(operations);
  const view = OPERATION_VIEW[kind];

  return (
    <>
      <table className={styles.references} data-testid="velero-volume-rows">
        <thead>
          <tr>
            <th scope="col">Volume</th>
            <th scope="col">Pod</th>
            <th scope="col">Phase</th>
            <th scope="col">Bytes</th>
            <th scope="col">Node</th>
          </tr>
        </thead>
        <tbody ref={within}>
          {shown.map((operation) => {
            const name = operation.metadata.name;
            const pod = operationPod(operation);
            const volume =
              typeof operation.spec?.volume === "string" && operation.spec.volume ? operation.spec.volume : undefined;
            const message =
              typeof operation.status?.message === "string" && operation.status.message
                ? operation.status.message
                : undefined;

            return (
              <tr key={name} data-operation={name}>
                <td>
                  <button
                    type="button"
                    className={styles.link}
                    title={BAND_WORDS.way(noun(kind), name)}
                    data-way={name}
                    data-testid={`velero-open-${view}-${name}`}
                    onClick={() => openView({ kind: view, name })}
                  >
                    {volume ?? NOT_REPORTED}
                  </button>
                </td>
                <td>
                  <span
                    className={styles.cellWords}
                    data-pod={pod.name && pod.namespace ? `${pod.namespace}/${pod.name}` : "not-named"}
                  >
                    {pod.name && pod.namespace ? (
                      <LinkToPod name={pod.name} namespace={pod.namespace} />
                    ) : (
                      <WithTooltip>{pod.name ?? POD_NOT_NAMED}</WithTooltip>
                    )}
                  </span>
                </td>
                <td>
                  <VolumePhaseCell state={phaseOf(kind, operation)} message={message} />
                </td>
                <td>
                  <Bytes progress={bytesProgress(operation.status?.progress)} />
                </td>
                <td>
                  <NodeCell name={operationNode(kind, operation)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {more}
    </>
  );
}

// Ten at a time, and the command that shows ten more, which gives the focus to the first it added: where the focus
// was, the command may be gone.
function usePages<Item>(items: readonly Item[]) {
  const [pages, setPages] = React.useState(1);
  const [focusAt, setFocusAt] = React.useState<number | undefined>(undefined);
  const within = React.useRef<HTMLElement>(null);
  const shown = items.slice(0, pages * PAGE);

  React.useEffect(() => {
    if (focusAt === undefined) return;
    const added = within.current?.querySelectorAll<HTMLElement>("[data-way]")[focusAt];

    // The way of what was added, or what holds it when it is a name with no way.
    (added?.matches("button") ? added : (added?.querySelector<HTMLElement>("button") ?? added))?.focus();
  }, [focusAt]);
  const more =
    shown.length < items.length ? (
      <button
        type="button"
        className={styles.link}
        data-testid="velero-volume-more"
        onClick={() => {
          setFocusAt(shown.length);
          setPages(pages + 1);
        }}
      >
        {BAND_WORDS.more}
      </button>
    ) : null;

  return { shown, more, within: within as React.RefObject<never> };
}

// The backups or the restores the operations that used a repository belong to, ten at a time.
function Owners({ owners }: { owners: Reference[] }) {
  const { shown, more, within } = usePages(owners);

  return (
    <>
      <ul className={styles.named} data-testid="velero-used-by-owners" ref={within}>
        {shown.map((owner) => (
          <li key={owner.name} data-way={owner.name} tabIndex={-1}>
            <Target reference={owner} />
          </li>
        ))}
      </ul>
      {more}
    </>
  );
}

// The state of the phase of a row, as every view of an operation reads it.
function phaseOf(kind: VolumeKind, operation: VolumeOperation): VolumeOperationState {
  return volumeOperationState(kind, operation.status?.phase);
}

// What is known of a half beside its rows: that they are of an earlier read, and when.
function StaleRead({ kind, read }: { kind: VolumeKind; read: FamilyRead<unknown> }) {
  return isStale(read) ? (
    <p className={styles.factNote} data-testid="velero-volume-stale">
      {BAND_WORDS.stale(plural(kind), new Date(read.lastSuccess ?? 0).toLocaleTimeString())}
    </p>
  ) : null;
}

// One half of the band of a backup or of a restore: its words when it has no rows, or its count, its groups and its
// rows.
function BandHalf({ half, owner }: { half: VolumeHalf; owner: string }) {
  const state = halfState(half.read);
  const { kind } = half;

  if (state !== "rows") {
    const words =
      state === "loading" || state === "not-served"
        ? BAND_WORDS[state](plural(kind))
        : BAND_WORDS[state](plural(kind), owner);

    return (
      <p className={styles.stateText} data-testid="velero-volume-state" data-state={state}>
        {words}
      </p>
    );
  }
  if (!half.operations.length) {
    return (
      <>
        <p className={styles.stateText} data-testid="velero-volume-state" data-state="none">
          {BAND_WORDS.none(owner, noun(kind))}
        </p>
        <StaleRead kind={kind} read={half.read} />
      </>
    );
  }
  return (
    <>
      <p className={styles.factNote} data-testid="velero-volume-count">
        {BAND_WORDS.count(half.operations.length, noun(kind), plural(kind))}
      </p>
      <Groups kind={kind} groups={half.groups} />
      <StaleRead kind={kind} read={half.read} />
      <Rows kind={kind} operations={half.operations} />
    </>
  );
}

export interface VolumeBandProps {
  installation: Installation;
  kind: OperationKind;
  owner: BackupResource | RestoreResource;
  state: OperationState;
}

// The band of the volume operations in the summary of a backup or of a restore (SPEC-0014, REQ-187): what the release
// does with them by the phase of the owner, then its pod volume operations, counted by phase, from the newest. It says
// nothing of the items of the owner, whose progress is in its status.
export const VolumeBand = observer(({ installation, kind, owner, state }: VolumeBandProps) => {
  const index = volumesOf(installation);
  const band =
    kind === "Backup"
      ? backupBand(index, owner as BackupResource, state)
      : restoreBand(index, owner as RestoreResource, state);

  return (
    <section data-testid="velero-volume-band" data-kind={band.kind} data-state={halfState(band.read)}>
      <h3 className={styles.sectionTitle}>{BAND_WORDS.title}</h3>
      <p className={styles.factNote} data-testid="velero-volume-sentence">
        {band.sentence}
      </p>
      {/* The rows are of the owner that was read: another one under the same name has its own. */}
      <BandHalf key={owner.metadata.uid ?? owner.metadata.name} half={band} owner={OWNER_NOUN[band.kind]} />
    </section>
  );
});

// What used a repository, by kind (SPEC-0014, REQ-187): the kinds read are counted by phase with the newest of each
// and the backups and restores they belong to, each a way; the kinds not read are named. Nothing used it is said
// only when every kind was read and none names it.
export const UsedBy = observer(
  ({ installation, repository }: { installation: Installation; repository: BackupRepositoryResource }) => {
    const uses = repositoryUses(volumesOf(installation), repository, {
      backups: installation.read("backups"),
      restores: installation.read("restores"),
    });
    const nothing = uses.every((use) => halfState(use.read) === "rows" && !use.operations.length);

    return (
      <section data-testid="velero-used-by">
        <h3 className={styles.sectionTitle}>{USED_BY_WORDS.title}</h3>
        {nothing ? (
          <p className={styles.stateText} data-testid="velero-used-by-nothing">
            {USED_BY_WORDS.nothing}
          </p>
        ) : (
          uses.map((use) => <Use key={use.kind} use={use} />)
        )}
      </section>
    );
  },
);

function Use({ use }: { use: ReturnType<typeof repositoryUses>[number] }) {
  const state = halfState(use.read);
  const { kind } = use;

  return (
    <div data-testid={`velero-used-by-${OPERATION_VIEW[kind]}`} data-state={state}>
      <h4 className={styles.factName}>{VIEWS[OPERATION_VIEW[kind]].title}</h4>
      {state !== "rows" ? (
        <p className={styles.stateText} data-state={state}>
          {USED_BY_WORDS[state](plural(kind))}
        </p>
      ) : !use.operations.length ? (
        <p className={styles.stateText} data-state="none">
          {USED_BY_WORDS.none(plural(kind))}
        </p>
      ) : (
        <>
          <p className={styles.factNote} data-testid="velero-used-by-count">
            {USED_BY_WORDS.count(use.operations.length, noun(kind), plural(kind))}
          </p>
          <Groups kind={kind} groups={use.groups} />
          <StaleRead kind={kind} read={use.read} />
          <div className={styles.band}>
            <div className={styles.fact}>
              <div className={styles.factName}>{USED_BY_WORDS.newest}</div>
              <div className={styles.factValue}>
                <button
                  type="button"
                  className={styles.link}
                  data-testid={`velero-open-${OPERATION_VIEW[kind]}-${use.operations[0].metadata.name}`}
                  onClick={() => openView({ kind: OPERATION_VIEW[kind], name: use.operations[0].metadata.name })}
                >
                  {use.operations[0].metadata.name}
                </button>
              </div>
            </div>
            <div className={styles.fact}>
              <div className={styles.factName}>
                {USED_BY_WORDS.owners(VIEWS[OWNER_NOUN[kind] as "backup" | "restore"].plural)}
              </div>
              <div className={styles.factValue}>
                <Owners owners={use.owners} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
