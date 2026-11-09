import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import {
  patchResultWords,
  pauseMeaning,
  resumeMeaning,
  SCHEDULE_PATCH_VIEW_WORDS,
} from "../../common/schedule-patch-words";
import styles from "../components/views.module.css";
import { focusFirst } from "../components/views-frame";
import { Fact, NotShown, ReviewText, Workspace } from "../components/workspace";
import { replaceView } from "../navigation";
import { adherenceOf, backupsAnswered } from "../state/adherence";

import type { PatchAction } from "../../common/schedule-patch-words";
import type { ScheduleResource } from "../../common/types";
import type { Installation } from "../state/installation";

const {
  Component: { Button, Icon },
} = Renderer;

const ID = "velero-schedule-patch";

export interface SchedulePatchWorkspaceProps {
  installation: Installation;
  action: PatchAction;
  // The name of the schedule the pause or the resume is asked of.
  name: string;
  now: number;
  back: string;
  onBack: () => void;
}

// A pause or a resume of a schedule (SPEC-0017, REQ-274 to REQ-277): for a resume, the choice of skipping the run that
// is due; the review of the patch the main process will send beside what it means; and the schedule as it was read
// after the patch, one after the other in the same place, over the view of the schedule.
export const SchedulePatchWorkspace = observer(
  ({ installation, action, name, now, back, onBack }: SchedulePatchWorkspaceProps) => {
    const namespace = installation.namespace ?? "";
    const read = installation.read("schedules");
    const schedule = (read.items as ScheduleResource[]).find((item) => item.metadata.name === name);
    const uid = schedule?.metadata.uid;
    const expression = typeof schedule?.spec?.schedule === "string" ? schedule.spec.schedule : undefined;
    const carried = schedule?.spec?.skipImmediately;
    const state = installation.pauseResume;
    const step = state.step;
    const writes = installation.writes;
    const gate = installation.gate;
    const title = SCHEDULE_PATCH_VIEW_WORDS.title(action);
    const body = React.useRef<HTMLDivElement>(null);
    const status = React.useRef<HTMLDivElement>(null);
    // A gesture of the workspace changed what it shows: the control that was used went with it.
    const gesture = React.useRef(false);
    const by = (act: () => void) => () => {
      gesture.current = true;
      act();
    };
    // The form is of this action and this schedule, or of another one whose patch is being sent.
    const ours = state.action === action && state.schedule?.name === name && state.schedule.uid === uid;
    const busy =
      ours && step.state === "asking"
        ? SCHEDULE_PATCH_VIEW_WORDS.asking
        : ours && step.state === "running"
          ? SCHEDULE_PATCH_VIEW_WORDS.running(action, name)
          : "";
    // A patch of another schedule that is being sent is waited for: the form of this one is given when it ends.
    const waiting = state.busy;

    React.useEffect(() => {
      if (uid && !waiting) state.open(action, { name, uid, ...(expression ? { expression } : {}) }, carried);
    }, [state, action, name, uid, expression, carried, waiting]);

    // An end the workspace shows is seen: it is not said again elsewhere.
    const ended = ours && (step.state === "done" || step.state === "failed");

    React.useEffect(() => {
      if (ended) state.see();
    }, [state, ended, step]);

    // A review is left with the workspace that shows it.
    React.useEffect(() => () => state.leave(), [state]);

    // The focus of a control that went is given to what took its place: while the main process is asked, the words
    // that say so; then the review or the result; after a failure or a review that was left, the command that asks
    // again, or the words of the failure when no command follows. When the operator moved to something else in the
    // meantime the focus is theirs.
    React.useEffect(() => {
      if (!gesture.current) return;
      if (!busy) gesture.current = false;
      const active = document.activeElement;
      // A control that was disabled by the gesture keeps the focus without being where the operator moved it.
      const free = !active || active === document.body || active === status.current || active.matches(":disabled");

      if (!free && document.body.contains(active)) return;
      if (busy) status.current?.focus();
      else
        focusFirst(body.current, [
          `[data-testid="${ID}-review"]`,
          `[data-testid="${ID}-result"]`,
          `[data-testid="${ID}-ask"]:not(:disabled)`,
          `[data-testid="${ID}-to-target"]`,
          `[data-testid="${ID}-failure"]`,
        ]);
    }, [busy, step.state]);

    if (!schedule || !uid) {
      return (
        <Workspace kind={action} name={name} title={title} back={back} onBack={onBack}>
          <NotShown kind={action} namespace={namespace} read={read} />
        </Workspace>
      );
    }
    if (!ours) {
      return (
        <Workspace kind={action} name={name} uid={uid} title={title} back={back} onBack={onBack}>
          <p className={styles.stateText} data-testid={`${ID}-another`}>
            {state.schedule && state.busy ? SCHEDULE_PATCH_VIEW_WORDS.another(state.schedule.name) : null}
          </p>
        </Workspace>
      );
    }
    const paused = schedule.spec?.paused === true;
    // The action the view offers for the schedule as it was last read, in place of the form: a review, a patch being
    // sent and an end are shown whatever the read says since, and a failure above the words.
    const offered = action === "schedule-pause" ? !paused : paused;
    const editing = step.state === "form" || step.state === "failed";
    const refused =
      editing && !offered
        ? SCHEDULE_PATCH_VIEW_WORDS.notNow(action, name)
        : action === "schedule-resume" && !expression
          ? SCHEDULE_PATCH_VIEW_WORDS.noExpression(name)
          : undefined;
    const noWay = !gate && installation.gateFailure !== undefined && !installation.gateUnknown;
    const cluster = gate?.cluster.name ?? installation.cluster.name;
    const context = gate?.cluster.context ?? "";

    return (
      <Workspace kind={action} name={name} uid={uid} title={title} back={back} onBack={onBack}>
        <div ref={body} data-testid={`${ID}-body`} data-action={action} data-step={step.state}>
          <p className={styles.factNote} data-testid={`${ID}-what`}>
            {SCHEDULE_PATCH_VIEW_WORDS.what(action, name, namespace)}
          </p>
          {step.state === "reviewing" ? (
            <Review
              installation={installation}
              action={action}
              schedule={schedule}
              skip={state.skip}
              now={now}
              text={step.text}
              replaced={step.replaced === true}
              cluster={cluster}
              context={context}
              onRun={by(() => void state.run())}
              onBack={by(() => state.leave())}
            />
          ) : step.state === "done" ? (
            <section
              className={styles.writeConfirmation}
              data-testid={`${ID}-result`}
              data-paused={String(step.changed.paused)}
              aria-label={patchResultWords(action, step.changed)[0]}
              tabIndex={-1}
            >
              {patchResultWords(action, step.changed).map((words, at) => (
                <p key={words} className={styles.stateText} data-testid={`${ID}-result-${at}`}>
                  {words}
                </p>
              ))}
              {step.changed.found ? (
                <p className={styles.factNote} data-testid={`${ID}-found`}>
                  {SCHEDULE_PATCH_VIEW_WORDS.found}
                </p>
              ) : null}
              <p className={styles.factNote}>{SCHEDULE_PATCH_VIEW_WORDS.openNote}</p>
              <div className={styles.writeActions}>
                <Button primary data-testid={`${ID}-open`} onClick={() => replaceView({ kind: "schedule", name })}>
                  <Icon material="open_in_new" small aria-hidden />
                  {SCHEDULE_PATCH_VIEW_WORDS.open(name)}
                </Button>
              </div>
            </section>
          ) : (
            <>
              {step.state === "failed" ? (
                <div
                  data-testid={`${ID}-failure`}
                  data-code={step.failure.code}
                  data-stage={step.failure.stage}
                  data-left={step.left}
                  role="alert"
                  tabIndex={-1}
                >
                  <p className={styles.stateText} data-testid={`${ID}-failure-text`}>
                    {step.failure.text}
                  </p>
                  {step.left === "unknown" ? (
                    <p className={styles.factNote} data-testid={`${ID}-failure-left`}>
                      {SCHEDULE_PATCH_VIEW_WORDS.unknownLeft}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {refused ? (
                <p className={styles.stateText} data-testid={`${ID}-refused`}>
                  {refused}
                </p>
              ) : null}
              {refused ? null : action === "schedule-resume" ? (
                // The choice is named by its label alone, and its note and what the schedule carries, under it,
                // describe it.
                <fieldset className={styles.templateField} data-testid={`${ID}-choice`}>
                  <legend className={styles.factName}>The resume</legend>
                  <div className={styles.flagChoice}>
                    <label className={styles.templateChoice}>
                      <input
                        type="checkbox"
                        data-testid={`${ID}-skip`}
                        checked={state.skip}
                        disabled={!editing}
                        aria-describedby={`${ID}-skip-note ${ID}-carried`}
                        onChange={(event) => state.choose(event.target.checked)}
                      />
                      {SCHEDULE_PATCH_VIEW_WORDS.skip}
                    </label>
                    <p id={`${ID}-skip-note`} className={`${styles.factNote} ${styles.flagNote}`}>
                      {SCHEDULE_PATCH_VIEW_WORDS.skipNote}
                    </p>
                    <p
                      id={`${ID}-carried`}
                      className={`${styles.factNote} ${styles.flagNote}`}
                      data-testid={`${ID}-carried`}
                    >
                      {SCHEDULE_PATCH_VIEW_WORDS.carried(carried, state.skip)}
                    </p>
                  </div>
                </fieldset>
              ) : null}
              {/* What the workspace is doing, said to who does not see: the part is always there, and its words
                  change. */}
              {refused ? null : (
                <div
                  ref={status}
                  role="status"
                  tabIndex={-1}
                  className={busy ? `${styles.factNote} ${styles.serverFocus}` : undefined}
                  data-testid={`${ID}-status`}
                >
                  {busy}
                </div>
              )}
              {busy || refused ? null : !writes.on ? (
                <>
                  <p className={styles.factNote} data-testid={`${ID}-writes-off`}>
                    {noWay
                      ? installation.gateFailure
                      : installation.gateUnknown
                        ? SCHEDULE_PATCH_VIEW_WORDS.gateUnknown
                        : SCHEDULE_PATCH_VIEW_WORDS.writesOff(action)}
                  </p>
                  {noWay ? null : (
                    <div className={styles.writeActions}>
                      <button
                        type="button"
                        className={styles.link}
                        data-testid={`${ID}-to-target`}
                        onClick={(event) =>
                          focusFirst(event.currentTarget.ownerDocument.body, [
                            '[data-testid="velero-writes-on"]',
                            '[data-testid="velero-writes-ask"]',
                          ])
                        }
                      >
                        Go to the writes in the target bar
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className={styles.writeActions}>
                  <Button primary data-testid={`${ID}-ask`} onClick={by(() => void state.review())}>
                    <Icon material="fact_check" small aria-hidden />
                    {SCHEDULE_PATCH_VIEW_WORDS.ask}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </Workspace>
    );
  },
);

interface ReviewProps {
  installation: Installation;
  action: PatchAction;
  schedule: ScheduleResource;
  skip: boolean;
  now: number;
  text: string;
  // The review took the place of one whose text changed while it was read.
  replaced: boolean;
  cluster: string;
  context: string;
  onRun: () => void;
  onBack: () => void;
}

// The review is the confirmation (SPEC-0017, REQ-246, REQ-276): the patch the main process will send, as it came,
// beside what it means, with the context and the namespace. Escape leaves it, as the command that leaves it does, and
// the workspace stays. The focus is not on the command that sends, so that the key that asked is not the one that
// confirms.
function Review(props: ReviewProps) {
  const { installation, action, schedule, skip, now, text, replaced, cluster, context, onRun, onBack } = props;
  // What a resume would do is computed from the backups of the installation, once they were answered.
  const adherence = backupsAnswered(installation) ? adherenceOf(installation, now) : undefined;
  const meaning =
    action === "schedule-pause" ? pauseMeaning(schedule, adherence) : resumeMeaning(schedule, skip, adherence);

  return (
    <section
      className={`${styles.writeConfirmation} ${styles.review}`}
      data-testid={`${ID}-review`}
      aria-label={SCHEDULE_PATCH_VIEW_WORDS.title(action)}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // The key is of the review: what holds it does not take it for its own way back.
        event.stopPropagation();
        onBack();
      }}
    >
      {replaced ? (
        <p className={styles.stateText} data-testid={`${ID}-replaced`} role="status">
          {SCHEDULE_PATCH_VIEW_WORDS.replaced}
        </p>
      ) : null}
      <p className={styles.stateText}>{SCHEDULE_PATCH_VIEW_WORDS.review(action)}</p>
      <div className={styles.band}>
        <Fact name="Schedule">{schedule.metadata.name}</Fact>
        <Fact name="Namespace">{installation.namespace ?? ""}</Fact>
        <Fact name="Cluster">{context ? `${cluster} (context ${context})` : cluster}</Fact>
      </div>
      <div className={styles.reviewColumns}>
        <div className={styles.reviewPart}>
          <h4 className={styles.factName}>{SCHEDULE_PATCH_VIEW_WORDS.meaning}</h4>
          <ul className={styles.reviewMeaning} data-testid={`${ID}-meaning`}>
            {meaning.map((part) => (
              <li key={part.id} className={styles.reviewMeaningPart} data-part={part.id}>
                {part.words}
              </li>
            ))}
          </ul>
        </div>
        <ReviewText id={ID} title={SCHEDULE_PATCH_VIEW_WORDS.text}>
          {text}
        </ReviewText>
      </div>
      <div className={styles.writeActions}>
        <Button primary data-testid={`${ID}-run`} onClick={onRun}>
          <Icon material={action === "schedule-pause" ? "pause" : "play_arrow"} small aria-hidden />
          {SCHEDULE_PATCH_VIEW_WORDS.command(action)}
        </Button>
        <Button plain data-testid={`${ID}-back`} onClick={onBack}>
          <Icon material="close" small aria-hidden />
          {SCHEDULE_PATCH_VIEW_WORDS.leave(action)}
        </Button>
      </div>
    </section>
  );
}
