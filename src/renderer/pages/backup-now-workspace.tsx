import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { BACKUP_NAME_WORDS, backupFromScheduleMeaning, readBody } from "../../common/backup-from-schedule";
import { BACKUP_NOW_VIEW_WORDS } from "../../common/backup-now-words";
import { escapeOfField } from "../components/artifact-viewer";
import styles from "../components/views.module.css";
import { focusFirst } from "../components/views-frame";
import { Fact, NotShown, ViewLink, Workspace } from "../components/workspace";
import { replaceView } from "../navigation";

import type { ScheduleResource } from "../../common/types";
import type { BackupNow, BackupNowEnd } from "../state/backup-now";
import type { Installation } from "../state/installation";

const {
  Component: { Button, Icon, Input },
} = Renderer;

const ID = "velero-backup-now";

// What an end says in words: the backup created, with what Velero wrote of it, or the words of the failure.
function endWords(end: BackupNowEnd): string {
  if (end.state === "failed") return end.failure.text;
  const phase = end.backup.phase ? BACKUP_NOW_VIEW_WORDS.phase(end.backup.phase) : BACKUP_NOW_VIEW_WORDS.unread;

  return `${BACKUP_NOW_VIEW_WORDS.created(end.backup.name)} ${phase}`;
}

// The end of a backup asked from another schedule that no workspace showed, above the form, with the way to the
// backup created, until the operator lets it go.
const Earlier = observer(({ state }: { state: BackupNow }) => {
  const earlier = state.earlier;

  // Shown here: the main process keeps it no more.
  React.useEffect(() => {
    if (earlier) state.seeEarlier();
  }, [state, earlier]);
  if (!earlier) return null;
  const { schedule, end } = earlier;

  return (
    <section
      className={styles.writeConfirmation}
      data-testid={`${ID}-earlier`}
      data-state={end.state}
      aria-label={BACKUP_NOW_VIEW_WORDS.earlier(schedule)}
    >
      <p className={styles.stateText}>{BACKUP_NOW_VIEW_WORDS.earlier(schedule)}</p>
      <p className={styles.stateText} data-testid={`${ID}-earlier-words`}>
        {endWords(end)}
      </p>
      <div className={styles.writeActions}>
        {end.state === "created" ? (
          <ViewLink target={{ kind: "backup", name: end.backup.name }}>Open the backup {end.backup.name}</ViewLink>
        ) : null}
        <button
          type="button"
          className={styles.link}
          data-testid={`${ID}-earlier-let-go`}
          onClick={() => state.letGo()}
        >
          Let it go
        </button>
      </div>
    </section>
  );
});

export interface BackupNowWorkspaceProps {
  installation: Installation;
  // The name of the schedule the backup is asked from.
  name: string;
  back: string;
  onBack: () => void;
}

// A backup asked from a schedule by hand (SPEC-0017, REQ-252, REQ-255 to REQ-259): the form with the name of the
// backup, the review of what the main process will send beside what it means, and what Velero wrote of the backup
// once it was created, one after the other in the same place, over the view of the schedule.
export const BackupNowWorkspace = observer(({ installation, name, back, onBack }: BackupNowWorkspaceProps) => {
  const namespace = installation.namespace ?? "";
  const read = installation.read("schedules");
  const schedule = (read.items as ScheduleResource[]).find((item) => item.metadata.name === name);
  const uid = schedule?.metadata.uid;
  const state = installation.backupNow;
  const step = state.step;
  const writes = installation.writes;
  const gate = installation.gate;
  const body = React.useRef<HTMLDivElement>(null);
  const status = React.useRef<HTMLDivElement>(null);
  // A gesture of the workspace changed what it shows: the control that was used went with it.
  const gesture = React.useRef(false);
  const by = (act: () => void) => () => {
    gesture.current = true;
    act();
  };
  // The form is of this schedule, or of another one whose backup is being created.
  const ours = state.schedule?.name === name && state.schedule.uid === uid;
  const busy =
    ours && step.state === "asking"
      ? BACKUP_NOW_VIEW_WORDS.asking
      : ours && step.state === "running"
        ? BACKUP_NOW_VIEW_WORDS.running(step.name)
        : "";

  // The workspace opened, by the command of the schedule or by the address: the form of the schedule. A backup asked
  // from another schedule that was being created is waited for: the form of this one is given when it ends.
  const waiting = state.busy;

  React.useEffect(() => {
    if (uid && !waiting) state.open({ name, uid });
  }, [state, name, uid, waiting]);

  // An end the workspace shows is seen: it is not said again elsewhere.
  const ended = ours && (step.state === "created" || step.state === "failed");

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
      <Workspace kind="backup-now" name={name} title="Back up now" back={back} onBack={onBack}>
        <NotShown kind="backup-now" namespace={namespace} read={read} />
      </Workspace>
    );
  }
  if (!ours) {
    return (
      <Workspace kind="backup-now" name={name} uid={uid} title="Back up now" back={back} onBack={onBack}>
        <p className={styles.stateText} data-testid={`${ID}-another`}>
          {state.schedule && state.busy ? BACKUP_NOW_VIEW_WORDS.another(state.schedule.name) : null}
        </p>
      </Workspace>
    );
  }
  const refused = state.refused;
  const problem = state.problem;
  const noWay = !gate && installation.gateFailure !== undefined && !installation.gateUnknown;
  const cluster = gate?.cluster.name ?? installation.cluster.name;
  const context = gate?.cluster.context ?? "";

  return (
    <Workspace kind="backup-now" name={name} uid={uid} title="Back up now" back={back} onBack={onBack}>
      <div ref={body} data-testid={`${ID}-body`} data-step={step.state}>
        <p className={styles.factNote} data-testid={`${ID}-what`}>
          {BACKUP_NOW_VIEW_WORDS.what(name, namespace)}
        </p>
        <Earlier state={state} />
        {refused ? (
          <p className={styles.stateText} data-testid={`${ID}-refused`}>
            {refused}
          </p>
        ) : step.state === "reviewing" ? (
          <Review
            installation={installation}
            schedule={schedule}
            name={step.name}
            text={step.text}
            replaced={step.replaced === true}
            cluster={cluster}
            context={context}
            onCreate={by(() => void state.create())}
            onBack={by(() => state.leave())}
          />
        ) : step.state === "created" ? (
          <section
            className={styles.writeConfirmation}
            data-testid={`${ID}-result`}
            data-phase={step.backup.phase ?? ""}
            aria-label={BACKUP_NOW_VIEW_WORDS.created(step.backup.name)}
            tabIndex={-1}
          >
            <p className={styles.stateText}>{BACKUP_NOW_VIEW_WORDS.created(step.backup.name)}</p>
            {step.backup.found ? (
              <p className={styles.factNote} data-testid={`${ID}-found`}>
                {BACKUP_NOW_VIEW_WORDS.found}
              </p>
            ) : null}
            <p className={styles.stateText} data-testid={`${ID}-phase`}>
              {step.backup.phase ? BACKUP_NOW_VIEW_WORDS.phase(step.backup.phase) : BACKUP_NOW_VIEW_WORDS.unread}
            </p>
            <p className={styles.factNote}>{BACKUP_NOW_VIEW_WORDS.listed}</p>
            <div className={styles.writeActions}>
              <Button
                primary
                data-testid={`${ID}-open`}
                onClick={() => replaceView({ kind: "backup", name: step.backup.name })}
              >
                <Icon material="open_in_new" small aria-hidden />
                Open the backup {step.backup.name}
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
                {step.failure.code === "conflict" && step.failure.stage === "creation" ? (
                  <p className={styles.factNote}>
                    <ViewLink target={{ kind: "backup", name: step.name }}>Open the backup {step.name}</ViewLink>
                  </p>
                ) : null}
                {step.left === "unknown" ? (
                  <p className={styles.factNote} data-testid={`${ID}-failure-left`}>
                    {BACKUP_NOW_VIEW_WORDS.unknownLeft}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className={styles.backupName}>
              <span id={`${ID}-name-label`} className={styles.factName}>
                Name of the backup
              </span>
              {/* The host keeps an identifier it is given for itself: the field is named by its label, and its rule
                  and what is wrong with it are tied to it. Enter asks for the review and keeps the focus. Escape
                  gives back the name the form proposed, and is not the key that leaves the view. */}
              <Input
                theme="round-black"
                aria-labelledby={`${ID}-name-label`}
                aria-describedby={`${ID}-name-rule${problem ? ` ${ID}-name-problem` : ""}`}
                aria-invalid={problem ? true : undefined}
                data-testid={`${ID}-field`}
                value={state.name}
                disabled={step.state !== "form" && step.state !== "failed"}
                blurOnEnter={false}
                onChange={(next) => state.type(next)}
                onSubmit={by(() => void state.review())}
                onKeyDown={(event) => {
                  escapeOfField(event, () => state.type(state.proposed));
                }}
              />
              <p id={`${ID}-name-rule`} className={styles.factNote}>
                {BACKUP_NAME_WORDS.rule}
              </p>
              {problem ? (
                <p id={`${ID}-name-problem`} className={styles.formError} data-testid={`${ID}-name-problem`}>
                  {problem}
                </p>
              ) : null}
            </div>
            {/* What the workspace is doing, said to who does not see: the part is always there, and its words
                change. */}
            <div
              ref={status}
              role="status"
              tabIndex={-1}
              className={busy ? `${styles.factNote} ${styles.serverFocus}` : undefined}
              data-testid={`${ID}-status`}
            >
              {busy}
            </div>
            {busy ? null : !writes.on ? (
              <>
                <p className={styles.factNote} data-testid={`${ID}-writes-off`}>
                  {noWay
                    ? installation.gateFailure
                    : installation.gateUnknown
                      ? BACKUP_NOW_VIEW_WORDS.gateUnknown
                      : BACKUP_NOW_VIEW_WORDS.writesOff}
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
                <Button
                  primary
                  data-testid={`${ID}-ask`}
                  disabled={Boolean(problem)}
                  onClick={by(() => void state.review())}
                >
                  <Icon material="fact_check" small aria-hidden />
                  Review the backup
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Workspace>
  );
});

interface ReviewProps {
  installation: Installation;
  schedule: ScheduleResource;
  name: string;
  text: string;
  // The review took the place of one whose schedule changed while it was read.
  replaced: boolean;
  cluster: string;
  context: string;
  onCreate: () => void;
  onBack: () => void;
}

// The review is the confirmation (SPEC-0017, REQ-246, REQ-247): the text the main process will send, as it came,
// beside what it means, with the context and the namespace. Escape leaves it, as the command that leaves it does, and
// the workspace stays. The focus is not on the command that creates, so that the key that asked is not the one that
// confirms.
function Review({ installation, schedule, name, text, replaced, cluster, context, onCreate, onBack }: ReviewProps) {
  const body = readBody(text);
  const meaning = body ? backupFromScheduleMeaning(schedule, body) : [];

  return (
    <section
      className={`${styles.writeConfirmation} ${styles.review}`}
      data-testid={`${ID}-review`}
      aria-label="The Backup that will be created"
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
          {BACKUP_NOW_VIEW_WORDS.replaced}
        </p>
      ) : null}
      <p className={styles.stateText}>{BACKUP_NOW_VIEW_WORDS.review}</p>
      <div className={styles.band}>
        <Fact name="Name">{name}</Fact>
        <Fact name="Namespace">{installation.namespace ?? ""}</Fact>
        <Fact name="Cluster">{context ? `${cluster} (context ${context})` : cluster}</Fact>
      </div>
      <div className={styles.reviewColumns}>
        <div className={styles.reviewPart}>
          <h4 className={styles.factName}>{BACKUP_NOW_VIEW_WORDS.meaning}</h4>
          <ul className={styles.reviewMeaning} data-testid={`${ID}-meaning`}>
            {meaning.map((part) => (
              <li key={part.id} className={styles.reviewMeaningPart} data-part={part.id}>
                {part.words}
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.reviewPart}>
          <h4 className={styles.factName}>{BACKUP_NOW_VIEW_WORDS.text}</h4>
          {/* A text longer than its room scrolls, and Chromium gives the keyboard a scroller with nothing to focus in
              it. */}
          <pre className={styles.reviewText} data-testid={`${ID}-text`}>
            {text}
          </pre>
        </div>
      </div>
      <div className={styles.writeActions}>
        <Button primary data-testid={`${ID}-create`} onClick={onCreate}>
          <Icon material="check" small aria-hidden />
          Create the backup
        </Button>
        <Button plain data-testid={`${ID}-back`} onClick={onBack}>
          <Icon material="close" small aria-hidden />
          Do not create it
        </Button>
      </div>
    </section>
  );
}
