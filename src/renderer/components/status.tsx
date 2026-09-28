import { Renderer } from "@freelensapp/extensions";
import { lifecycleText, phaseText, signalMark, signalText, timeText } from "../../common/operation-text";
import styles from "./views.module.css";

import type { OperationEvidence } from "../../common/evidence";
import type { Lifecycle, OperationState } from "../../common/phases";

const {
  Component: { Icon },
} = Renderer;

const LIFECYCLE_ICONS: Record<Lifecycle, string> = {
  "in-flight": "autorenew",
  terminal: "check_circle_outline",
  deleting: "delete_outline",
  unknown: "help_outline",
};
// A phase that finished in a failure does not get the mark of what went well.
const FAILED_ICON = "highlight_off";

export function phaseIcon(state: OperationState): string {
  return state.lifecycle === "terminal" && state.failure !== "none" ? FAILED_ICON : LIFECYCLE_ICONS[state.lifecycle];
}

const SIGNAL_ICONS = {
  failure: "error_outline",
  warnings: "warning_amber",
  none: "check",
  unknown: "help_outline",
  "not-counted": "remove",
};
const SIGNAL_STYLES = {
  failure: styles.signalFailure,
  warnings: styles.signalWarnings,
  none: styles.signalNone,
  unknown: styles.signalUnknown,
  // What is not counted has the look of what is not known, never the one of what went well.
  "not-counted": styles.signalUnknown,
};

// Where the operation is. The icon says whether it is still going, the words say the phase: the two are
// read together, and the failure is apart.
export function Phase({ state }: { state: OperationState }) {
  const text = phaseText(state);

  return (
    <span className={styles.status} title={`${lifecycleText(state)}: ${state.reported ?? text}`} data-phase={text}>
      <Icon material={phaseIcon(state)} small aria-hidden />
      <span className={styles.statusText}>{text}</span>
    </span>
  );
}

// What the operation says of a failure, in words beside the icon.
export function Signal({ evidence, title }: { evidence: OperationEvidence; title?: string }) {
  const text = signalText(evidence);
  const mark = signalMark(evidence);

  return (
    <span
      className={`${styles.status} ${SIGNAL_STYLES[mark]}`}
      title={title ?? text}
      data-signal={evidence.signal}
      data-mark={mark}
    >
      <Icon material={SIGNAL_ICONS[mark]} small aria-hidden />
      <span className={styles.statusText}>{text}</span>
    </span>
  );
}

export const time = timeText;
