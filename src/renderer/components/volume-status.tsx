import { Renderer } from "@freelensapp/extensions";
import { unwrittenResult } from "../../common/volume-phases";
import {
  bytesText,
  bytesTip,
  NOT_REPORTED,
  NOT_WRITTEN,
  POD_NOT_NAMED,
  phaseSentence,
  REPOSITORY_WORDS,
  volumePhaseText,
} from "../../common/volume-words";
import { openView } from "../navigation";
import styles from "./views.module.css";

import type { ItemProgress } from "../../common/progress";
import type { Reference } from "../../common/references";
import type { ViewKind } from "../../common/views";
import type {
  MaintenanceResult,
  Readiness,
  RepositoryReadiness,
  VolumeOperationState,
} from "../../common/volume-phases";
import type { PodOf } from "../../common/volume-references";

const {
  Component: { Icon, LinkToNode, LinkToPod, WithTooltip },
} = Renderer;

// The mark of where an operation is, each beside its word: a shape that says it without a colour. A cancellation
// has a shape of its own, which is neither the one of a success nor the one of a failure.
export function volumePhaseIcon(state: VolumeOperationState): string {
  if (state.lifecycle === "unknown") return "help_outline";
  if (state.cancelAsked) return "stop_circle";
  if (state.execution === "running") return "autorenew";
  switch (state.outcome) {
    case "completed":
      return "check_circle_outline";
    case "failed":
      return "highlight_off";
    case "cancelled":
      return "block";
    default:
      return "hourglass_empty";
  }
}

const PHASE_STYLES: Record<VolumeOperationState["outcome"], string> = {
  none: "",
  completed: "",
  failed: styles.signalFailure,
  cancelled: "",
  unknown: styles.signalUnknown,
};

// The phase of an operation: its mark and its word, with the message of Velero in the tip when it wrote one.
export function VolumePhase({ state, message }: { state: VolumeOperationState; message?: string }) {
  const text = volumePhaseText(state);

  return (
    <span
      className={`${styles.status} ${PHASE_STYLES[state.outcome]}`}
      title={message ?? state.reported ?? text}
      data-phase={state.reported ?? "none"}
      data-outcome={state.outcome}
    >
      <Icon material={volumePhaseIcon(state)} small aria-hidden />
      <span className={styles.statusText}>{text}</span>
    </span>
  );
}

// The cell of the phase in a list: the words can be cut, so they are in the badge of the host, with the message
// in its tip. An operation with no phase or New, which carries no message, says in its tip what it waits for.
export function VolumePhaseCell({ state, message }: { state: VolumeOperationState; message?: string }) {
  const waiting = state.recognized && (state.reported === undefined || state.reported === "New");

  return (
    <span className={styles.cellWords}>
      <WithTooltip tooltip={message ?? (waiting ? phaseSentence(state) : volumePhaseText(state))}>
        <VolumePhase state={state} message={message} />
      </WithTooltip>
    </span>
  );
}

const READINESS_ICONS: Record<Readiness, string> = {
  ready: "check",
  "not-ready": "error_outline",
  "not-initialized": "hourglass_empty",
  unknown: "help_outline",
};
const READINESS_STYLES: Record<Readiness, string> = {
  ready: "",
  "not-ready": styles.signalFailure,
  "not-initialized": "",
  unknown: styles.signalUnknown,
};

// Whether Velero can use a repository: a mark and a word, with the message of Velero in the tip.
export function RepositoryReadinessMark({ readiness, message }: { readiness: RepositoryReadiness; message?: string }) {
  const text = readiness.readiness === "unknown" ? `${readiness.label}: ${readiness.reported}` : readiness.label;

  return (
    <span
      className={`${styles.status} ${READINESS_STYLES[readiness.readiness]}`}
      title={message ?? readiness.reported ?? text}
      data-readiness={readiness.readiness}
    >
      <Icon material={READINESS_ICONS[readiness.readiness]} small aria-hidden />
      <span className={styles.statusText}>{text}</span>
    </span>
  );
}

// A value as it is written. One the reviewed release does not write has the mark of what is not known before it, the
// shape the phase and the readiness use, with its words for who does not see the mark (REQ-182).
export function WrittenValue({ text, known }: { text: string; known: boolean }) {
  if (known) return <>{text}</>;
  return (
    <span className={`${styles.status} ${styles.signalUnknown}`} data-written="unknown">
      <Icon material="help_outline" small aria-hidden />
      <span className={styles.statusText}>{text}</span>
      <span className={styles.spoken}>, {NOT_WRITTEN.mark}</span>
    </span>
  );
}

// The result of one maintenance of a repository in its word: a failure in the colour of one, and a result the
// reviewed release does not write as its text with the mark of what is not known.
export function MaintenanceResultMark({ result }: { result: MaintenanceResult }) {
  const unwritten = unwrittenResult(result);

  return (
    <span
      className={`${styles.status} ${
        result.result === "failed" ? styles.signalFailure : unwritten ? styles.signalUnknown : ""
      }`}
      data-result={result.reported ?? "none"}
    >
      {unwritten ? <Icon material="help_outline" small aria-hidden /> : null}
      <span className={styles.statusText}>{unwritten ? `${result.label}: ${result.reported}` : result.label}</span>
    </span>
  );
}

// The mark of a newest maintenance that failed, beside the time of the last one that succeeded. Its words are said
// to who does not see the mark.
export function FailedMaintenanceMark() {
  return (
    <span
      className={`${styles.status} ${styles.signalWarnings}`}
      data-maintenance="failed"
      title={REPOSITORY_WORDS.newestFailed}
    >
      <Icon material="warning_amber" small aria-hidden />
      <span className={styles.spoken}>, {REPOSITORY_WORDS.newestFailed}</span>
    </span>
  );
}

// The bytes of an operation in words, with the bar of their percentage when one can be given.
export function Bytes({ progress, testId }: { progress: ItemProgress; testId?: string }) {
  return (
    <>
      <span data-testid={testId} title={bytesTip(progress)}>
        {bytesText(progress)}
      </span>
      {progress.percentage !== undefined ? (
        <div
          className={styles.progressTrack}
          role="progressbar"
          aria-label="Bytes"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percentage}
        >
          <div className={styles.progressBar} style={{ width: `${progress.percentage}%` }} />
        </div>
      ) : null}
    </>
  );
}

// The way to the details the host shows of the pod of an operation, which the host resolves when they open: the
// extension reads nothing of the pod, and does not say whether it is there.
export function PodLink({ pod }: { pod: PodOf }) {
  if (!pod.name || !pod.namespace) return <span data-pod="not-named">{pod.name ?? POD_NOT_NAMED}</span>;
  return (
    <span data-pod={`${pod.namespace}/${pod.name}`}>
      <LinkToPod name={pod.name} namespace={pod.namespace} />
    </span>
  );
}

// The way to the details the host shows of a node, as for a pod.
export function NodeLink({ name }: { name?: string }) {
  if (!name) return <span data-node="none">{NOT_REPORTED}</span>;
  return (
    <span data-node={name}>
      <LinkToNode name={name} />
    </span>
  );
}

// A reference in a cell of a list: a way to the view of its target when the target is there, which opens over the
// list as the name of a row does; its name otherwise, with why in the tip.
export function CellWay({ reference, kind }: { reference?: Reference; kind: ViewKind }) {
  if (!reference) return <span className={styles.muted}>{NOT_REPORTED}</span>;
  if (reference.state !== "resolved") {
    return (
      <span className={styles.cellWords} data-reference={reference.state}>
        <WithTooltip tooltip={reference.reason}>{reference.name}</WithTooltip>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={styles.rowLink}
      title={reference.reason || reference.name}
      data-reference="resolved"
      data-testid={`velero-cell-${kind}-${reference.name}`}
      onClick={(event) => {
        event.stopPropagation();
        openView({ kind, name: reference.name });
      }}
    >
      {reference.name}
    </button>
  );
}
