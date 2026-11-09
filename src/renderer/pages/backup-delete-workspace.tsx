import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { BACKUP_CREATE_VIEW_WORDS } from "../../common/backup-create-words";
import {
  BACKUP_DELETE_VIEW_WORDS,
  type DeleteReviewContext,
  deletedWords,
  deleteMeaning,
  deleteOffered,
} from "../../common/backup-delete-words";
import { escapeOfField } from "../components/artifact-viewer";
import styles from "../components/views.module.css";
import { focusFirst } from "../components/views-frame";
import { Fact, ViewLink, Workspace } from "../components/workspace";
import { replaceView } from "../navigation";

import type { BackupResource } from "../../common/types";
import type { BackupDelete } from "../state/backup-delete";
import type { Installation } from "../state/installation";

const {
  Component: { Button, Icon, Input },
} = Renderer;

const ID = "velero-backup-delete";

export interface BackupDeleteWorkspaceProps {
  installation: Installation;
  // The backup the deletion is of, by its name.
  name: string;
  back: string;
  onBack: () => void;
}

// What the views read of the storage location of a backup, for the review (REQ-280): not there, or its access mode and
// its phase; nothing while the locations are not read.
function locationRead(installation: Installation, location: string): Pick<DeleteReviewContext, "location"> {
  const read = installation.read("storageLocations");
  const known = read.status === "ready" || read.lastSuccess !== undefined;
  const found = (
    read.items as { metadata: { name: string }; spec?: { accessMode?: unknown }; status?: { phase?: unknown } }[]
  ).find((item) => item.metadata.name === location);

  if (!found) return known ? { location: { missing: true } } : {};
  return {
    location: {
      ...(typeof found.spec?.accessMode === "string" ? { accessMode: found.spec.accessMode } : {}),
      ...(typeof found.status?.phase === "string" ? { phase: found.status.phase } : {}),
    },
  };
}

// The workspace of the deletion of one backup (SPEC-0017, REQ-278 to REQ-284), over the view of the backup: what a
// deletion does, the command that asks the main process for its review, the review with the name of the backup typed,
// and the result, which reads the request and the backup together until what they show is an end.
export const BackupDeleteWorkspace = observer(({ installation, name, back, onBack }: BackupDeleteWorkspaceProps) => {
  const namespace = installation.namespace ?? "";
  const state = installation.backupDelete;
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
  const backups = backupsRead.items as BackupResource[];
  const backup = backups.find((item) => item.metadata.name === name);
  const uid = backup?.metadata.uid;
  const phase = backup?.status?.phase;
  const location = backup?.spec?.storageLocation;
  const offered = deleteOffered(phase, location);
  // The deletion is of this backup, by its name and its UID, or of another one, whose deletion may be being asked: then
  // nothing of it is shown here.
  const ours = uid !== undefined && state.backup?.name === name && state.backup.uid === uid;
  const step = ours ? state.step : ({ state: "form" } as const);
  const busy =
    step.state === "asking"
      ? BACKUP_DELETE_VIEW_WORDS.asking
      : step.state === "running"
        ? BACKUP_DELETE_VIEW_WORDS.running(step.backup.name)
        : "";
  // A deletion of another backup that is being asked is waited for: the workspace of this one is given when it ends.
  const waiting = !ours && state.busy;
  const another = waiting && state.backup ? BACKUP_DELETE_VIEW_WORDS.another(state.backup.name) : undefined;

  // The workspace is of the backup of the view: one opened from the address, or for a backup created again under its
  // name, is started here once the backup is read, and once a deletion of another one ended, since a deletion takes no
  // other start while it is being asked.
  React.useEffect(() => {
    if (uid) state.start({ kind: "Backup", name, uid });
  }, [state, name, uid, waiting]);

  // An end the workspace shows is seen: it is not said again elsewhere.
  const ended = step.state === "done" || step.state === "failed";

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

  // What holds the review back that the main process does not see: no backup read, or one not offered.
  const known = backupsRead.status === "ready" || backupsRead.lastSuccess !== undefined;
  const held = !backup
    ? known
      ? BACKUP_DELETE_VIEW_WORDS.backupMissing(name, namespace)
      : backupsRead.status === "forbidden"
        ? BACKUP_DELETE_VIEW_WORDS.backupsForbidden
        : backupsRead.status === "idle" || backupsRead.status === "loading"
          ? BACKUP_DELETE_VIEW_WORDS.backupNotRead
          : BACKUP_DELETE_VIEW_WORDS.backupsFailed
    : offered.offered
      ? undefined
      : offered.words;
  const noWay = !gate && installation.gateFailure !== undefined && !installation.gateUnknown;
  const cluster = gate?.cluster.name ?? installation.cluster.name;
  const context = gate?.cluster.context ?? "";
  // What the review says is of the backup it is of, as the installation reads it now: its phase, its location and what
  // the views read of the location; a phase Velero refuses to delete holds Delete backup back, as the main process
  // would refuse it.
  const reviewed =
    step.state === "reviewing"
      ? backups.find((item) => item.metadata.name === step.backup.name && item.metadata.uid === step.backup.uid)
      : undefined;
  const reviewedPhase = reviewed?.status?.phase;
  const reviewedLocation = reviewed?.spec?.storageLocation;
  const reviewedOffered = deleteOffered(reviewedPhase, reviewedLocation);

  return (
    <Workspace
      kind="backup-delete"
      name={name}
      {...(uid ? { uid } : {})}
      title={BACKUP_DELETE_VIEW_WORDS.title(name)}
      back={back}
      onBack={onBack}
    >
      <div ref={body} data-testid={`${ID}-body`} data-step={step.state}>
        <p className={styles.factNote} data-testid={`${ID}-what`}>
          {BACKUP_DELETE_VIEW_WORDS.what(name, namespace)}
        </p>
        {step.state === "reviewing" ? (
          <Review
            installation={installation}
            state={state}
            backup={step.backup.name}
            text={step.text}
            cluster={cluster}
            context={context}
            meaning={{
              ...(reviewedPhase ? { backupPhase: reviewedPhase } : {}),
              ...(reviewedLocation ? { storageLocation: reviewedLocation } : {}),
              ...(reviewedLocation ? locationRead(installation, reviewedLocation) : {}),
              others: step.others ?? "unread",
            }}
            {...(reviewedOffered.offered ? {} : { held: reviewedOffered.words })}
            onRun={by(() => void state.run())}
            onBack={by(() => state.leave())}
          />
        ) : step.state === "done" ? (
          <section
            className={styles.writeConfirmation}
            data-testid={`${ID}-result`}
            data-end={step.deleted.end}
            aria-label={BACKUP_DELETE_VIEW_WORDS.title(step.backup.name)}
            tabIndex={-1}
          >
            {step.deleted.found ? (
              <p className={styles.factNote} data-testid={`${ID}-found`}>
                {step.deleted.requestsUnread ? BACKUP_DELETE_VIEW_WORDS.foundUnread : BACKUP_DELETE_VIEW_WORDS.found}
              </p>
            ) : null}
            {deletedWords(step.backup.name, step.deleted).map((words, at) => (
              <p key={words} className={`${styles.stateText} ${styles.preLine}`} data-testid={`${ID}-result-${at}`}>
                {words}
              </p>
            ))}
            {step.deleted.end === "completed" ? null : (
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
            )}
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
                  <>
                    <p className={styles.factNote} data-testid={`${ID}-failure-left`}>
                      {BACKUP_DELETE_VIEW_WORDS.unknownLeft}
                    </p>
                    <p className={styles.factNote}>
                      <ViewLink target={{ kind: "backup", name }}>Open the backup {name}</ViewLink>
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}
            <div
              ref={status}
              role="status"
              tabIndex={-1}
              className={busy ? `${styles.factNote} ${styles.serverFocus}` : undefined}
              data-testid={`${ID}-status`}
            >
              {busy}
            </div>
            {another ? (
              <p className={styles.stateText} data-testid={`${ID}-another`}>
                {another}
              </p>
            ) : busy ? null : !writes.on ? (
              <>
                <p className={styles.factNote} data-testid={`${ID}-writes-off`}>
                  {noWay
                    ? installation.gateFailure
                    : installation.gateUnknown
                      ? BACKUP_CREATE_VIEW_WORDS.gateUnknown
                      : BACKUP_DELETE_VIEW_WORDS.writesOff}
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
                  disabled={held !== undefined}
                  aria-describedby={held !== undefined ? `${ID}-held` : undefined}
                  onClick={by(() => void state.review())}
                >
                  <Icon material="fact_check" small aria-hidden />
                  Review the deletion
                </Button>
                {held !== undefined ? (
                  <p id={`${ID}-held`} className={styles.factNote} data-testid={`${ID}-held`}>
                    {held}
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
  state: BackupDelete;
  backup: string;
  text: string;
  cluster: string;
  context: string;
  meaning: DeleteReviewContext;
  // Why Delete backup is held back: the backup is now in a phase Velero refuses to delete.
  held?: string;
  onRun: () => void;
  onBack: () => void;
}

// The review is the confirmation (SPEC-0017, REQ-279 to REQ-281, REQ-283): the text the main process will send, as it
// came, beside what it means, with the context and the namespace; and the field where the name of the backup is typed,
// which enables Delete backup once it is the name as it is written. Escape leaves it, and the workspace stays. The focus
// is not on the command that deletes.
const Review = observer(
  ({ installation, state, backup, text, cluster, context, meaning, held, onRun, onBack }: ReviewProps) => {
    const parts = deleteMeaning(backup, meaning);
    const confirmed = state.confirmed && held === undefined;

    return (
      <section
        className={`${styles.writeConfirmation} ${styles.review}`}
        data-testid={`${ID}-review`}
        aria-label="The DeleteBackupRequest that will be created"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          onBack();
        }}
      >
        <p className={styles.stateText}>{BACKUP_DELETE_VIEW_WORDS.review}</p>
        <div className={styles.band}>
          <Fact name="Backup">{backup}</Fact>
          <Fact name="Namespace">{installation.namespace ?? ""}</Fact>
          <Fact name="Cluster">{context ? `${cluster} (context ${context})` : cluster}</Fact>
        </div>
        <div className={styles.reviewColumns}>
          <div className={styles.reviewPart}>
            <h4 className={styles.factName}>{BACKUP_DELETE_VIEW_WORDS.meaning}</h4>
            <ul className={styles.reviewMeaning} data-testid={`${ID}-meaning`}>
              {parts.map((part) => (
                <li key={part.id} className={styles.reviewMeaningPart} data-part={part.id}>
                  {part.words}
                </li>
              ))}
            </ul>
          </div>
          <div className={styles.reviewPart}>
            <h4 className={styles.factName}>{BACKUP_DELETE_VIEW_WORDS.text}</h4>
            <pre className={styles.reviewText} data-testid={`${ID}-text`}>
              {text}
            </pre>
          </div>
        </div>
        <div className={styles.backupName}>
          <span id={`${ID}-typed-label`} className={styles.factName}>
            Name of the backup
          </span>
          {/* The second gesture: the name of the backup typed as it is written. Escape in the field takes back what was
              typed; Enter deletes once it is the name. */}
          <Input
            theme="round-black"
            aria-labelledby={`${ID}-typed-label`}
            aria-describedby={`${ID}-typed-rule ${ID}-typed-state`}
            data-testid={`${ID}-typed`}
            value={state.typed}
            blurOnEnter={false}
            onChange={(next) => state.typeBackup(next)}
            onSubmit={() => {
              if (confirmed) onRun();
            }}
            onKeyDown={(event) => {
              escapeOfField(event, () => state.typeBackup(""));
            }}
          />
          <p id={`${ID}-typed-rule`} className={styles.factNote}>
            {BACKUP_DELETE_VIEW_WORDS.typeBackup(backup)}
          </p>
          <p id={`${ID}-typed-state`} className={styles.factNote} data-testid={`${ID}-typed-state`} aria-live="polite">
            {held ?? (confirmed ? BACKUP_DELETE_VIEW_WORDS.typed : BACKUP_DELETE_VIEW_WORDS.notTyped(backup))}
          </p>
        </div>
        <div className={styles.writeActions}>
          <Button primary data-testid={`${ID}-run`} disabled={!confirmed} onClick={onRun}>
            <Icon material="delete" small aria-hidden />
            Delete backup
          </Button>
          <Button plain data-testid={`${ID}-back`} onClick={onBack}>
            <Icon material="close" small aria-hidden />
            Do not delete it
          </Button>
        </div>
      </section>
    );
  },
);
