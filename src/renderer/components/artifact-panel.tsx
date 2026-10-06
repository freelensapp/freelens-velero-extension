import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import {
  ASKING,
  againNote,
  allowCommand,
  allowNote,
  askAgainNote,
  beginAgain,
  CANCEL_COMMAND,
  CANCELLING,
  cameBy,
  cameThrough,
  loadCommand,
  loadedText,
  loadStep,
  missingFile,
  NOT_AGAIN,
  nothingToAsk,
  requestWords,
  savableNoMore,
  savableUntil,
  saveCommand,
  savingText,
  TO_THE_WRITES,
  wouldCreate,
  writesOff,
} from "../../common/artifact-text";
import { createdNothing } from "../../common/diagnostic-text";
import { downloadRequestName } from "../../common/ipc";
import { operationState } from "../../common/phases";
import { CONTENT } from "./artifact-viewer";
import { LogViewer } from "./log-viewer";
import { ResourcesViewer } from "./resources-viewer";
import { ResultsViewer } from "./results-viewer";
import { time } from "./status";
import styles from "./views.module.css";
import { focusFirst } from "./views-frame";
import { VolumesViewer } from "./volumes-viewer";
import { WriteConfirmation } from "./write-confirmation";

import type { AllowanceFor } from "../../common/allowances";
import type { ArtifactSource, ArtifactTab } from "../../common/artifact-text";
import type { Failure, WriteKind } from "../../common/ipc";
import type { OperationKind, OperationState } from "../../common/phases";
import type { Installation } from "../state/installation";
import type { ArtifactViewerProps } from "./artifact-viewer";

const {
  Component: { Button, Icon, Spinner },
} = Renderer;

const KIND: WriteKind = "DownloadRequest";
// The code of a load that ended at a store without the file that was asked, and the one of a load the
// operator cancelled.
const MISSING = "artifact-missing";
const CANCELLED = "cancelled";
// The mark of a load that ended without its text, by what it ended as: a fault, a file the store does not
// have, which the phase of the operation accounts for, or what the operator asked for.
const ENDED = { fault: "error_outline", missing: "info_outline", cancelled: "cancel" } as const;

// The viewer of each tab, which is given the text its tab loaded. The clock of the views, and every read
// of the installation, draw the tab again: its viewer is drawn again only when what it is given changed.
const VIEWERS: Record<ArtifactTab, React.ComponentType<ArtifactViewerProps>> = {
  log: React.memo(LogViewer),
  results: React.memo(ResultsViewer),
  resources: React.memo(ResourcesViewer),
  volumes: React.memo(VolumesViewer),
};

// The name the parts of the panel of a tab are found by: the kind of the operation and the tab.
export function artifactPanelId(kind: OperationKind, tab: ArtifactTab): string {
  return `velero-${kind.toLowerCase()}-${tab}`;
}

// Where an operation was when the store was found without a file of it. What a missing file means is said
// by that, in the past and with when the store was asked: an operation that went on since, or ended, was
// not asked again, and nothing is claimed of what its storage holds now.
const foundMissing = new WeakMap<Failure, OperationState>();

function whenMissing(failure: Failure, now: OperationState): OperationState {
  const then = foundMissing.get(failure) ?? now;

  foundMissing.set(failure, then);
  return then;
}

export interface ArtifactPanelProps {
  installation: Installation;
  // The kind of the operation the tab is of, and the tab.
  kind: OperationKind;
  tab: ArtifactTab;
  // The backup or the restore, as the view read it.
  object: ArtifactSource & { status?: { phase?: string } };
  // The counters the status of the object writes, which the results are given with its phase.
  counters?: ArtifactViewerProps["counters"];
}

// The panel of one diagnostic tab: what Velero wrote of the operation into its storage, loaded when the
// operator asks for it and not before. Opening the tab asks nothing. It shows where the load is, each state
// with its words: what the tab would create and the state of the gate; the confirmation of the request,
// inline, with the object as it will be submitted; the step the main process is at, with the way to cancel;
// the text in its viewer, with when it was loaded, its size and the way it came by; or how the load ended
// without it. Loading again, and asking again, is another request, and goes through its confirmation.
//
// What was loaded comes first: over it one line, when it was loaded and its size beside the commands that
// load it again and save it, and under it what is said of the request, of the way the file came by, of
// what loading again does and of until when the text can be saved.
export const ArtifactPanel = observer(({ installation, kind, tab, object, counters }: ArtifactPanelProps) => {
  const id = artifactPanelId(kind, tab);
  const name = object.metadata.name;
  const namespace = installation.namespace ?? "";
  // The load of the tab is asked of the installation each time the panel is drawn: when what the
  // installation held of the view was dropped, the one it gives is a new one, at its first state.
  const load = installation.artifacts.load(kind, name, tab);
  const step = load.step;
  const gate = installation.gate;
  const writes = installation.writes;
  // The views have no way to the main process: writes cannot be turned on, here or in the target bar.
  const noWay = !gate && installation.gateFailure !== undefined && !installation.gateUnknown;
  // What Velero signs no URL for is said from what the view read, and nothing is asked for it.
  const nothing = nothingToAsk(tab, kind, object, {
    backups: installation.read("backups"),
    storageLocations: installation.read("storageLocations"),
  });
  // The text the tab shows: the one it loaded, which stays under the confirmation of a load again until
  // the request is created.
  const text = load.shown;
  const failure = step.state === "failed" ? step.failure : undefined;
  const needs = failure?.needs;
  // The text is loaded, and nothing is asked over it: its commands are beside what is said of it.
  const settled = step.state === "loaded";
  // A load that ended before anything was created left no request: the one that is asked after it is no
  // other one. Of every other load, loaded or not, the next is another request.
  const another = step.state !== "first" && !(failure && createdNothing(failure.stage));
  // What a load ended as, which its mark and its line say beside its words.
  const ended = failure?.code === CANCELLED ? "cancelled" : failure?.code === MISSING ? "missing" : "fault";
  // What the tab is doing while the main process is asked: no command but the one that cancels is offered
  // meanwhile, whatever the state of the writes becomes, since a request that runs is not left.
  const busy =
    step.state === "asking"
      ? ASKING
      : step.state === "loading"
        ? step.cancelling
          ? CANCELLING
          : loadStep(step.step, step.count, downloadRequestName(name, step.request), step.pages)
        : "";
  // The same, as it is said to who does not see: the step, and nothing that moves while the load is at it.
  // The words that are seen carry the seconds of a wait, the bytes of a download and the page that is
  // taken, which change several times a second: said as they change, they would be said without end.
  const said =
    step.state === "loading" && !step.cancelling
      ? loadStep(step.step, undefined, downloadRequestName(name, step.request))
      : busy;
  // The dialog of the host is open for the file a text is saved into.
  const choosing = load.saving.state === "asked";
  // What the command of the tab does, said before it is given, or what is said where none is offered.
  const note =
    text && !failure
      ? againNote(tab)
      : !failure
        ? wouldCreate(tab, { kind, name, namespace, cluster: gate?.cluster.name ?? installation.cluster.name })
        : needs
          ? allowNote(tab)
          : failure.retry
            ? askAgainNote(namespace, another)
            : NOT_AGAIN;
  const words = requestWords(tab, { kind, name });
  const Viewer = VIEWERS[tab];
  // The counters the results are given are the same ones for as long as they count the same.
  const errors = counters?.errors;
  const warnings = counters?.warnings;
  const counted = React.useMemo(
    () => ({ ...(errors === undefined ? {} : { errors }), ...(warnings === undefined ? {} : { warnings }) }),
    [errors, warnings],
  );
  const body = React.useRef<HTMLDivElement>(null);
  const status = React.useRef<HTMLDivElement>(null);
  const saved = React.useRef<HTMLSpanElement>(null);
  const kept = React.useRef<HTMLParagraphElement>(null);
  // Whether the focus is on the command that saves: a command that goes with the focus on it says nothing
  // of losing it.
  const onSaving = React.useRef(false);
  // The time the main process held the text for has passed, and the command that saves went with it.
  const expired = load.expired;
  // The focus is of nothing the operator moved it to: it is on nothing, or on the words of the tab.
  const free = () => {
    const active = document.activeElement;

    return !active || active === document.body || active === status.current || !document.body.contains(active);
  };
  // A gesture of the tab changed what it shows: the control that was used went with it.
  const gesture = React.useRef(false);
  const by = (act: () => void) => () => {
    gesture.current = true;
    act();
  };
  // The text the tab last showed: one that is shown again when a confirmation over it is left did not
  // arrive then.
  const shown = React.useRef(text);

  // The operator allows what the download said it needs. The installation asks the main process to keep
  // it, and the artifact is asked again only when it was kept, and the tab is still where it was.
  const allow = async (allowed: AllowanceFor) => {
    if ((await installation.allow(allowed)) && load.step === step) void load.ask();
  };

  // The focus of a control that went is given to what took its place: while the main process is asked,
  // the words that say so; then the first line of the text that arrived, the confirmation, the command, or
  // the words of a load that ended with no command to give. While the dialog of a saving is open it is on
  // what the saving is at. When the operator moved to something else in the meantime the focus is theirs.
  React.useEffect(() => {
    const arrived = step.state === "loaded" && step !== shown.current;

    shown.current = text;
    if (!gesture.current) return;
    if (!busy && !choosing) gesture.current = false;
    if (!free()) return;
    if (busy || choosing) {
      (busy ? status : saved).current?.focus();
      return;
    }
    if (!arrived) {
      focusFirst(body.current, [
        `[data-testid="${id}-confirm"]`,
        `[data-testid="${id}-create"]`,
        `[data-testid="${id}-allow"]`,
        `[data-testid="${id}-begin"]`,
        `[data-testid="${id}-to-target"]`,
        `[data-testid="${id}-failure"]`,
      ]);
      return;
    }
    const within = body.current;
    const first = () => within?.querySelector<HTMLElement>(`[${CONTENT}]`);
    const there = first();

    if (there || !within) {
      there?.focus();
      return;
    }
    // The first line of a text may be drawn a moment after its viewer: the list of the host measures its
    // room before it draws a row. The focus waits for it where it is, on the words of the tab.
    const drawn = new MutationObserver(() => {
      const line = first();

      if (!line) return;
      drawn.disconnect();
      if (free()) line.focus();
    });

    drawn.observe(within, { childList: true, subtree: true });
    return () => drawn.disconnect();
  }, [busy, choosing, step, text, id]);

  // A confirmation is left with the tab that shows it.
  React.useEffect(() => () => load.leave(), [load]);

  // The command that saves went while the keyboard was on it: the focus is given to the words that took
  // its place, and is not left on nothing.
  React.useEffect(() => {
    if (!expired || !onSaving.current) return;
    onSaving.current = false;
    if (free()) kept.current?.focus({ preventScroll: true });
  }, [expired]);

  // The command of the tab, in the name of what it creates or allows. What it does is said to who reaches
  // it with the keyboard as well: the words describe it.
  const command = needs ? (
    <Button plain data-testid={`${id}-allow`} aria-describedby={`${id}-what`} onClick={by(() => void allow(needs))}>
      <Icon material="verified_user" small aria-hidden />
      {allowCommand(needs)}
    </Button>
  ) : (
    <Button plain data-testid={`${id}-create`} aria-describedby={`${id}-what`} onClick={by(() => void load.ask())}>
      <Icon material="add_circle_outline" small aria-hidden />
      {loadCommand(tab, kind, another)}
    </Button>
  );
  // The request of a load again is being confirmed over the text that is shown.
  const again = step.state === "confirming" && text !== undefined;
  // What the command does. Under a text that is loaded it is among what is said of the text, in its
  // letters, and it stays there while the request of a load again is confirmed: what the second gesture
  // takes away is said when it is asked for.
  const what = (
    <p
      className={settled || again ? styles.artifactNote : styles.stateText}
      id={`${id}-what`}
      data-testid={`${id}-what`}
    >
      {note}
    </p>
  );
  // Whether the command is offered: not while the main process is asked, not after a load that is not to
  // be asked again, not for what Velero signs no URL for, not while writes are not on, and not while its
  // confirmation is shown.
  const commanded =
    !busy && !(failure && !needs && !failure.retry) && !nothing && writes.on && step.state !== "confirming";

  // What is offered where the command is not, when the main process is not being asked: after a load that
  // is not to be asked again, the one command that takes the tab back to where it was, whatever the gate
  // is at, since it asks nothing; what Velero signs no URL for; the state of the gate and the way to the
  // target bar while writes are not on, said first and apart, then what the command would do; or the
  // confirmation of the request.
  const offered = () => {
    if (busy) return null;
    if (failure && !needs && !failure.retry)
      return (
        <>
          <p className={styles.factNote} id={`${id}-not-again`} data-testid={`${id}-not-again`}>
            {note}
          </p>
          <div className={styles.artifactActions}>
            <Button
              plain
              data-testid={`${id}-begin`}
              aria-describedby={`${id}-not-again`}
              onClick={by(() => load.reset())}
            >
              <Icon material="undo" small aria-hidden />
              {beginAgain(text !== undefined)}
            </Button>
          </div>
        </>
      );
    if (nothing)
      return (
        <p className={styles.stateText} data-testid={`${id}-nothing`}>
          {nothing}
        </p>
      );
    if (!writes.on)
      return (
        <>
          <p className={styles.stateText} data-testid={`${id}-writes-off`}>
            {noWay ? installation.gateFailure : writesOff(installation.gateUnknown)}
          </p>
          {noWay ? null : (
            <div className={styles.artifactActions}>
              <button
                type="button"
                className={styles.link}
                data-testid={`${id}-to-target`}
                onClick={(event) =>
                  focusFirst(event.currentTarget.ownerDocument.body, [
                    '[data-testid="velero-writes-on"]',
                    '[data-testid="velero-writes-ask"]',
                  ])
                }
              >
                {TO_THE_WRITES}
              </button>
            </div>
          )}
          {what}
        </>
      );
    if (step.state === "confirming")
      return (
        <WriteConfirmation
          id={`${id}-confirm`}
          object={{
            kind: KIND,
            apiVersion: "velero.io/v1",
            name: { words: words.name },
            namespace,
            cluster: gate?.cluster.name ?? installation.cluster.name,
            context: gate?.cluster.context ?? "",
            labels: words.labels,
            spec: words.spec,
            target: words.target,
          }}
          onCreate={by(() => void load.run())}
          onBack={by(() => load.leave())}
        />
      );
    return (
      <>
        {what}
        {/* Beside a text that is loaded the command is over the text, with the one that saves it. */}
        {settled ? null : <div className={styles.artifactActions}>{command}</div>}
        {needs && installation.allowanceFailure ? (
          <p className={styles.stateText} role="alert" data-testid={`${id}-allow-failure`}>
            {installation.allowanceFailure}
          </p>
        ) : null}
      </>
    );
  };

  return (
    <div
      ref={body}
      className={styles.artifact}
      data-testid={id}
      data-step={step.state}
      data-at={step.state === "loading" ? step.step : undefined}
      // The request a load runs, by the name it has in the cluster once it is created.
      data-request={step.state === "loading" ? downloadRequestName(name, step.request) : undefined}
    >
      {failure ? (
        // The words can be given the focus, which is where the keyboard would be left if no command followed.
        // What the operator asked for is said, and is no alert.
        <div
          className={`${styles.artifactFailure} ${styles.artifactFocus}`}
          data-testid={`${id}-failure`}
          data-code={failure.code}
          data-stage={failure.stage}
          data-ended={ended}
          role={ended === "cancelled" ? "status" : "alert"}
          tabIndex={-1}
        >
          <span className={styles.artifactMark}>
            <Icon material={ENDED[ended]} small aria-hidden />
          </span>
          <div className={styles.artifactWords}>
            <p className={styles.stateText} data-testid={`${id}-failure-text`}>
              {failure.text}
            </p>
            {failure.code === MISSING ? (
              <p className={styles.stateText} data-testid={`${id}-missing`}>
                {missingFile(
                  tab,
                  kind,
                  whenMissing(failure, stateOf(kind, object)),
                  step.state === "failed" ? time(step.at) : undefined,
                )}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {/* What the tab is doing, in words that are seen and can be given the focus: they follow what the
          step counts, and are not what is said to who does not see. The mark beside them moves while the
          main process is asked, and says nothing the words do not. */}
      <div
        ref={status}
        tabIndex={-1}
        className={busy ? `${styles.stateText} ${styles.artifactBusy} ${styles.artifactFocus}` : undefined}
        data-testid={`${id}-status`}
      >
        {busy ? <Spinner aria-hidden /> : null}
        {busy}
      </div>
      {/* What the tab is doing, said to who does not see: the part is always there, and its words change
          when the load comes to another step, and not while it is at one. */}
      <div role="status" className={styles.spoken} data-testid={`${id}-said`}>
        {said}
      </div>
      {step.state === "loading" && !step.cancelling ? (
        <div className={styles.artifactActions}>
          <Button plain data-testid={`${id}-cancel`} onClick={by(() => void load.cancel())}>
            <Icon material="cancel" small aria-hidden />
            {CANCEL_COMMAND}
          </Button>
        </div>
      ) : null}
      {text ? (
        // When the text was loaded and how much of it there is, in one line over it, with its commands
        // beside the words once nothing is asked over it.
        <div className={styles.artifactHead}>
          {/* The request the text came through and the bytes of the text, as they are and not as the words
              round them. */}
          <p
            className={styles.stateText}
            data-testid={`${id}-loaded`}
            data-request={text.value.request.name}
            data-size={text.value.size}
          >
            {loadedText(tab, text.value, time(text.at))}
          </p>
          {settled ? (
            <div className={styles.artifactActions}>
              {commanded ? command : null}
              {load.savable ? (
                <Button
                  plain
                  data-testid={`${id}-save`}
                  aria-describedby={`${id}-save-until`}
                  onClick={by(() => {
                    // The command goes while its dialog is open, and the focus with it, to what the saving is at.
                    onSaving.current = false;
                    void load.save();
                  })}
                  onFocus={() => {
                    onSaving.current = true;
                  }}
                  onBlur={() => {
                    onSaving.current = false;
                  }}
                >
                  <Icon material="save_alt" small aria-hidden />
                  {saveCommand(tab)}
                </Button>
              ) : null}
              {/* What became of the saving, said beside its command, to who does not see as well: the part
                  is always there, and its words change. */}
              <span
                ref={saved}
                role="status"
                tabIndex={-1}
                className={`${styles.artifactSaving} ${styles.artifactFocus}`}
                data-testid={`${id}-saving`}
                data-saving={load.saving.state}
              >
                {savingText(tab, load.saving) ?? ""}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
      {/* Over a text that is loaded nothing is offered but its commands: what is said of them is under it. */}
      {settled ? null : offered()}
      {text ? (
        <Viewer
          id={`${id}-viewer`}
          text={text.text}
          of={kind}
          {...(tab === "results" && counters ? { counters: counted, phase: object.status?.phase } : {})}
        />
      ) : null}
      {text ? (
        // What is said of the text, under it: the request it came through and the way it came by; what
        // loading it again does, or why that is not offered; and until when it can be saved.
        <div className={styles.artifactNotes} data-testid={`${id}-notes`}>
          <p className={styles.artifactNote}>
            <span data-testid={`${id}-through`}>{cameThrough(text.value.request.name)}</span>{" "}
            <span data-testid={`${id}-route`} data-route={text.value.route.mode}>
              {cameBy(text.value.route)}
            </span>
          </p>
          {settled ? offered() : again ? what : null}
          {/* Until when the text can be saved, while the main process holds it, and that it let it go when
              its time has passed. The words can be given the focus, which is where the keyboard is left when
              the command went. */}
          {settled && load.heldUntil !== undefined && (load.held !== undefined || expired) ? (
            <p
              ref={kept}
              id={`${id}-save-until`}
              className={`${styles.artifactNote} ${styles.artifactFocus}`}
              data-testid={`${id}-save-until`}
              tabIndex={-1}
            >
              {expired ? savableNoMore(tab, time(load.heldUntil)) : savableUntil(tab, time(load.heldUntil))}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

// Where the operation is, by its phase. One that has a time of deletion is being deleted, whatever its
// phase says: a restore has no phase for it.
function stateOf(kind: OperationKind, object: ArtifactPanelProps["object"]): OperationState {
  const state = operationState(kind, object.status?.phase);

  return object.metadata.deletionTimestamp ? { ...state, lifecycle: "deleting" } : state;
}
