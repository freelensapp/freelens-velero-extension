import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { BACKUP_CREATE_VIEW_WORDS, backupCreateMeaning, phaseWords } from "../../common/backup-create-words";
import { readFormBody } from "../../common/backup-form";
import { escapeOfField } from "../components/artifact-viewer";
import { BackupTemplateForm } from "../components/backup-template-form";
import { useTemplateChoices } from "../components/template-choices";
import styles from "../components/views.module.css";
import { focusFirst } from "../components/views-frame";
import { Fact, ViewLink, Workspace } from "../components/workspace";
import { replaceView } from "../navigation";

import type { BackupResource } from "../../common/types";
import type { Installation } from "../state/installation";

const {
  Component: { Button, Icon, Input },
} = Renderer;

const ID = "velero-backup-create";

// The name the address gives the workspace of the creation, which is of no object.
export const CREATE_VIEW_NAME = "new";

export interface BackupCreateWorkspaceProps {
  installation: Installation;
  back: string;
  onBack: () => void;
}

// A backup of the form (SPEC-0017, REQ-252, REQ-260 to REQ-264): the name and the template of the backup, the review of
// what the main process will send beside what it means, and what Velero wrote of the backup once it was created, one
// after the other in the same place, over the list of the Backups.
export const BackupCreateWorkspace = observer(({ installation, back, onBack }: BackupCreateWorkspaceProps) => {
  const namespace = installation.namespace ?? "";
  const state = installation.backupCreate;
  const step = state.step;
  const writes = installation.writes;
  const gate = installation.gate;
  const body = React.useRef<HTMLDivElement>(null);
  const status = React.useRef<HTMLDivElement>(null);
  const gesture = React.useRef(false);
  const by = (act: () => void) => () => {
    gesture.current = true;
    act();
  };
  const backupsRead = installation.read("backups");
  const { choices, blockers, snapshotLocations, listed, accessMode } = useTemplateChoices(installation, state);
  const busy =
    step.state === "asking"
      ? BACKUP_CREATE_VIEW_WORDS.asking
      : step.state === "running"
        ? BACKUP_CREATE_VIEW_WORDS.running(step.name)
        : "";

  // An end the workspace shows is seen: it is not said again elsewhere.
  const ended = step.state === "created" || step.state === "failed";

  React.useEffect(() => {
    if (ended) state.see();
  }, [state, ended, step]);

  // A review is left with the workspace that shows it.
  React.useEffect(() => () => state.leave(), [state]);

  // The focus of a control that went is given to what took its place, as in every workspace of an action.
  React.useEffect(() => {
    if (!gesture.current) return;
    if (!busy) gesture.current = false;
    const active = document.activeElement;
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

  const nameProblem = state.nameProblem;
  const taken = (backupsRead.items as BackupResource[]).some((backup) => backup.metadata.name === state.name);
  const refusedTemplate = Object.keys(state.problems).length > 0;
  const holdBack = Boolean(nameProblem) || refusedTemplate || blockers.length > 0;
  const noWay = !gate && installation.gateFailure !== undefined && !installation.gateUnknown;
  const cluster = gate?.cluster.name ?? installation.cluster.name;
  const context = gate?.cluster.context ?? "";
  const editing = step.state === "form" || step.state === "failed";

  return (
    <Workspace kind="backup-create" name={CREATE_VIEW_NAME} title="Create backup" back={back} onBack={onBack}>
      <div ref={body} data-testid={`${ID}-body`} data-step={step.state}>
        <p className={styles.factNote} data-testid={`${ID}-what`}>
          {BACKUP_CREATE_VIEW_WORDS.what(namespace)}
        </p>
        {step.state === "reviewing" ? (
          <Review
            installation={installation}
            name={step.name}
            text={step.text}
            replaced={step.replaced === true}
            cluster={cluster}
            context={context}
            accessMode={accessMode}
            listed={listed}
            snapshotLocations={snapshotLocations}
            onCreate={by(() => void state.create())}
            onBack={by(() => state.leave())}
          />
        ) : step.state === "created" ? (
          <section
            className={styles.writeConfirmation}
            data-testid={`${ID}-result`}
            data-phase={step.backup.phase ?? ""}
            aria-label={BACKUP_CREATE_VIEW_WORDS.created(step.backup.name)}
            tabIndex={-1}
          >
            <p className={styles.stateText}>{BACKUP_CREATE_VIEW_WORDS.created(step.backup.name)}</p>
            {step.backup.found ? (
              <p className={styles.factNote} data-testid={`${ID}-found`}>
                {BACKUP_CREATE_VIEW_WORDS.found}
              </p>
            ) : null}
            <p className={styles.stateText} data-testid={`${ID}-phase`}>
              {step.backup.phase
                ? phaseWords(step.backup.phase, step.backup.position)
                : BACKUP_CREATE_VIEW_WORDS.unread}
            </p>
            {step.backup.errors ? (
              <ul className={`${styles.stateText} ${styles.preLine}`} data-testid={`${ID}-errors`}>
                {step.backup.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : null}
            {step.backup.errorsLeft ? (
              <p className={styles.factNote} data-testid={`${ID}-errors-left`}>
                {BACKUP_CREATE_VIEW_WORDS.errorsLeft(step.backup.errorsLeft)}
              </p>
            ) : null}
            <p className={styles.factNote}>{BACKUP_CREATE_VIEW_WORDS.resolved}</p>
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
                    {BACKUP_CREATE_VIEW_WORDS.unknownLeft}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className={styles.backupName}>
              <span id={`${ID}-name-label`} className={styles.factName}>
                Name of the backup
              </span>
              {/* The name is the operator's: Escape in the field takes back what was typed, and goes no further. Enter
                  asks for the review and keeps the focus. */}
              <Input
                theme="round-black"
                aria-labelledby={`${ID}-name-label`}
                aria-describedby={`${ID}-name-rule${nameProblem && state.name ? ` ${ID}-name-problem` : ""}${taken ? ` ${ID}-name-taken` : ""}`}
                aria-invalid={nameProblem && state.name ? true : undefined}
                data-testid={`${ID}-field`}
                value={state.name}
                disabled={!editing}
                blurOnEnter={false}
                onChange={(next) => state.type(next)}
                onSubmit={by(() => void state.review(blockers))}
                onKeyDown={(event) => {
                  escapeOfField(event, () => state.type(""));
                }}
              />
              <p id={`${ID}-name-rule`} className={styles.factNote}>
                {BACKUP_CREATE_VIEW_WORDS.nameRule}
              </p>
              {nameProblem && state.name ? (
                <p id={`${ID}-name-problem`} className={styles.formError} data-testid={`${ID}-name-problem`}>
                  {nameProblem}
                </p>
              ) : null}
              {taken ? (
                <p id={`${ID}-name-taken`} className={styles.factNote} data-testid={`${ID}-name-taken`}>
                  {BACKUP_CREATE_VIEW_WORDS.nameTaken(state.name)}
                </p>
              ) : null}
            </div>
            <BackupTemplateForm
              state={state}
              choices={choices}
              disabled={!editing}
              id={ID}
              onSubmit={by(() => void state.review(blockers))}
            />
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
                      ? BACKUP_CREATE_VIEW_WORDS.gateUnknown
                      : BACKUP_CREATE_VIEW_WORDS.writesOff}
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
                  disabled={holdBack}
                  aria-describedby={holdBack ? `${ID}-held` : undefined}
                  onClick={by(() => void state.review(blockers))}
                >
                  <Icon material="fact_check" small aria-hidden />
                  Review the backup
                </Button>
                {holdBack ? (
                  <p id={`${ID}-held`} className={styles.factNote} data-testid={`${ID}-held`}>
                    {state.name ? BACKUP_CREATE_VIEW_WORDS.held : BACKUP_CREATE_VIEW_WORDS.heldName}
                  </p>
                ) : null}
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
  name: string;
  text: string;
  replaced: boolean;
  cluster: string;
  context: string;
  accessMode?: string;
  listed: string[];
  snapshotLocations: { name: string; provider: string }[];
  onCreate: () => void;
  onBack: () => void;
}

// The review is the confirmation (SPEC-0017, REQ-246, REQ-247, REQ-263): the text the main process will send, as it
// came, beside what it means, with the context and the namespace. Escape leaves it, and the workspace stays. The focus
// is not on the command that creates.
function Review({
  installation,
  name,
  text,
  replaced,
  cluster,
  context,
  accessMode,
  listed,
  snapshotLocations,
  onCreate,
  onBack,
}: ReviewProps) {
  const body = readFormBody(text);
  const meaning = body ? backupCreateMeaning(body, { accessMode, listed, snapshotLocations }) : [];

  return (
    <section
      className={`${styles.writeConfirmation} ${styles.review}`}
      data-testid={`${ID}-review`}
      aria-label="The Backup that will be created"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onBack();
      }}
    >
      {replaced ? (
        <p className={styles.stateText} data-testid={`${ID}-replaced`} role="status">
          {BACKUP_CREATE_VIEW_WORDS.replaced}
        </p>
      ) : null}
      <p className={styles.stateText}>{BACKUP_CREATE_VIEW_WORDS.review}</p>
      <div className={styles.band}>
        <Fact name="Name">{name}</Fact>
        <Fact name="Namespace">{installation.namespace ?? ""}</Fact>
        <Fact name="Cluster">{context ? `${cluster} (context ${context})` : cluster}</Fact>
      </div>
      <div className={styles.reviewColumns}>
        <div className={styles.reviewPart}>
          <h4 className={styles.factName}>{BACKUP_CREATE_VIEW_WORDS.meaning}</h4>
          <ul className={styles.reviewMeaning} data-testid={`${ID}-meaning`}>
            {meaning.map((part) => (
              <li key={part.id} className={styles.reviewMeaningPart} data-part={part.id}>
                {part.words}
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.reviewPart}>
          <h4 className={styles.factName}>{BACKUP_CREATE_VIEW_WORDS.text}</h4>
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
