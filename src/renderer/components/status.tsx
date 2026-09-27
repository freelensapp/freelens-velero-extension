import { Renderer } from "@freelensapp/extensions";
import { lifecycleText, phaseText, signalText } from "../../common/backup-view";
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

const SIGNAL_ICONS = { failure: "error_outline", warnings: "warning_amber", none: "check", unknown: "help_outline" };
const SIGNAL_STYLES = {
  failure: styles.signalFailure,
  warnings: styles.signalWarnings,
  none: styles.signalNone,
  unknown: styles.signalUnknown,
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

  return (
    <span
      className={`${styles.status} ${SIGNAL_STYLES[evidence.signal]}`}
      title={title ?? text}
      data-signal={evidence.signal}
    >
      <Icon material={SIGNAL_ICONS[evidence.signal]} small aria-hidden />
      <span className={styles.statusText}>{text}</span>
    </span>
  );
}

export function time(value: number | undefined): string {
  return value === undefined ? "Not reported" : new Date(value).toLocaleString();
}
