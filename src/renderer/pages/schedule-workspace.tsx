import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { backupScope } from "../../common/backup-scope";
import { durationText, signalText } from "../../common/operation-text";
import { operationTimeText } from "../../common/operation-time";
import { isStale } from "../../common/read-state";
import { scheduleRestores, templateReferences } from "../../common/references";
import { countsText, holdsSubmissions, scheduleHistory } from "../../common/schedule-history";
import { NOTES, ownedText, pausedText, scheduleView, zoneText } from "../../common/schedule-view";
import { HistoryStrip } from "../components/history-strip";
import { Phase, Signal, time } from "../components/status";
import styles from "../components/views.module.css";
import { Fact, NotShown, Restores, Stale, Target, ViewLink, Workspace } from "../components/workspace";
import { openView } from "../navigation";

import type { TemplateReferences } from "../../common/references";
import type { History } from "../../common/schedule-history";
import type { ScheduleState, Validation } from "../../common/schedule-view";
import type { BackupResource, ScheduleResource } from "../../common/types";
import type { Installation } from "../state/installation";

const {
  Component: { Icon },
} = Renderer;

const VALIDATION_ICONS: Record<Validation, string> = {
  valid: "check_circle_outline",
  invalid: "highlight_off",
  "not-validated": "help_outline",
  unknown: "help_outline",
};
const VALIDATION_STYLES: Record<Validation, string> = {
  valid: "",
  invalid: styles.signalFailure,
  "not-validated": styles.signalUnknown,
  unknown: styles.signalUnknown,
};

// What Velero says of the expression of a schedule: a mark and a word, which a color alone would not say.
export function ValidationMark({ state }: { state: ScheduleState }) {
  return (
    <span
      className={`${styles.status} ${VALIDATION_STYLES[state.validation]}`}
      title={state.reported ?? state.label}
      data-validation={state.validation}
    >
      <Icon material={VALIDATION_ICONS[state.validation]} small aria-hidden />
      <span className={styles.statusText}>{state.label}</span>
    </span>
  );
}

// How many backups of a history are shown at once, and how many more each time it is asked.
const PAGE = 20;

function HistoryList({ history, shown }: { history: Extract<History, { state: "listed" }>; shown?: string[] }) {
  const [pages, setPages] = React.useState(1);
  const items = shown ? history.items.filter((item) => shown.includes(item.view.name)) : history.items;
  const visible = items.slice(0, pages * PAGE);

  if (!items.length) return null;
  return (
    <>
      {/* In a narrow room the list keeps its columns and is scrolled by itself: the view around it is not. */}
      <div className={styles.scrolled}>
        <table className={styles.references} data-testid="velero-history-list">
          <thead>
            <tr>
              <th scope="col">Backup</th>
              <th scope="col">Phase</th>
              <th scope="col">Failure</th>
              <th scope="col">Time</th>
              <th scope="col">Duration</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ view, time: when }) => (
              <tr key={view.uid ?? view.name} data-history-row={view.name}>
                <td>
                  <ViewLink target={{ kind: "backup", name: view.name }} />
                </td>
                <td>
                  <Phase state={view.state} />
                </td>
                <td>
                  <Signal evidence={view.evidence} title={signalText(view.evidence)} />
                </td>
                <td data-time={when.of}>
                  {when.of === "none"
                    ? "Not reported"
                    : `${time(when.time)} (${operationTimeText(when, view.state.execution).toLowerCase()})`}
                </td>
                <td>{durationText(view.duration)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length < items.length ? (
        <button
          type="button"
          className={styles.link}
          data-testid="velero-history-more"
          onClick={() => setPages(pages + 1)}
        >
          Show {Math.min(PAGE, items.length - visible.length)} more of the {items.length - visible.length} older ones
        </button>
      ) : null}
    </>
  );
}

// Where the backups go when the template names no location. With more than one location marked default
// the view does not say which one takes a backup: the release has not settled it.
function defaultText(fallback: TemplateReferences["fallback"], location: string | undefined): string {
  switch (fallback?.state) {
    case "marked":
      return `Not set: Velero uses the location marked default, ${fallback.name}${location ? ` (${location})` : ""}.`;
    case "many-marked":
      return `Not set, and ${fallback.names.length} locations of this installation are marked default: ${fallback.names.join(", ")}. The release sends a backup to the first of them it finds, and keeps marked the one created last, which is ${fallback.kept}.`;
    case "none-marked":
      return "Not set, and no location of this installation is marked default: Velero uses the one the server names in its settings, which this view does not read.";
    default:
      return `Not set. Where the backups go is not known: ${fallback?.reason ?? "the storage locations were not read"}.`;
  }
}

function Template({ references, location }: { references: TemplateReferences; location?: string }) {
  const fallback = references.fallback;

  return (
    <table className={styles.references} data-testid="velero-schedule-references">
      <tbody>
        <tr>
          <th scope="row">Backup storage location</th>
          <td>
            {references.storageLocation ? (
              <Target reference={references.storageLocation}>
                {location ? <span className={styles.muted}> {location}</span> : null}
              </Target>
            ) : (
              <span data-testid="velero-schedule-default-location" data-default={fallback?.state}>
                {defaultText(fallback, location)}
              </span>
            )}
            {references.warning ? (
              <div className={styles.warning} role="note" data-testid="velero-schedule-location-warning">
                <Icon material="warning_amber" small aria-hidden /> {references.warning}
              </div>
            ) : null}
          </td>
        </tr>
        <tr>
          <th scope="row">Volume snapshot locations</th>
          <td>
            {references.volumeSnapshotLocations.length
              ? references.volumeSnapshotLocations.map((reference, index) => (
                  <span key={reference.name}>
                    {index ? ", " : ""}
                    <Target reference={reference} />
                  </span>
                ))
              : "Not set"}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export interface ScheduleWorkspaceProps {
  installation: Installation;
  name: string;
  now: number;
  back: string;
  onBack: () => void;
}

// One schedule, read only: whether Velero took its expression, whether it is paused, when it last asked for
// a backup and how the backups it made ended. Nothing here is computed from the expression: no next run, no
// run that was expected, nothing overdue. That needs what the schedule adherence establishes.
export const ScheduleWorkspace = observer(({ installation, name, now, back, onBack }: ScheduleWorkspaceProps) => {
  const namespace = installation.namespace ?? "";
  const read = installation.read("schedules");
  const schedule = (read.items as ScheduleResource[]).find((item) => item.metadata.name === name);
  const [shown, setShown] = React.useState<string[]>();

  // Another schedule has another history: what was shown alone of the one before is not of this one.
  React.useEffect(() => setShown(undefined), [name, namespace]);
  if (!schedule) {
    return (
      <Workspace kind="schedule" name={name} back={back} onBack={onBack}>
        <NotShown kind="schedule" namespace={namespace} read={read} />
      </Workspace>
    );
  }
  const view = scheduleView(schedule);
  const backups = installation.read("backups");
  const history = scheduleHistory(schedule, backups, now);
  const locations = installation.read("storageLocations");
  const references = templateReferences(schedule, {
    storageLocations: locations,
    snapshotLocations: installation.read("snapshotLocations"),
  });
  const target =
    references.storageLocation?.name ??
    (references.fallback?.state === "marked" ? references.fallback.name : undefined);
  const location = locations.items.find((item) => item.metadata.name === target);
  const restores = scheduleRestores(schedule, installation.read("restores"));
  const newest = history.state === "listed" ? history.items[0] : undefined;

  return (
    <Workspace kind="schedule" name={view.name} uid={view.uid} back={back} onBack={onBack}>
      <div className={styles.band} data-testid="velero-schedule-status">
        <Fact name="Validation">
          <ValidationMark state={view.state} />
        </Fact>
        <Fact name="Paused">
          <span data-paused={view.paused}>{pausedText(view.paused)}</span>
        </Fact>
        <Fact name="Schedule" note={`Time zone: ${zoneText(view.expression.zone)}`}>
          <code data-testid="velero-schedule-expression">{view.expression.written ?? "Not reported"}</code>
        </Fact>
        <Fact name="Last submission" note={NOTES.submission}>
          {time(view.lastSubmission)}
        </Fact>
        <Fact name="Newest backup">
          {newest ? (
            <span data-testid="velero-schedule-newest">
              <ViewLink target={{ kind: "backup", name: newest.view.name }} />{" "}
              <Signal evidence={newest.view.evidence} title={signalText(newest.view.evidence)} />
            </span>
          ) : history.state === "listed" ? (
            "None among the backups that exist"
          ) : (
            <span className={styles.muted}>Not known</span>
          )}
        </Fact>
        <Fact name="Last skipped">{time(view.lastSkipped)}</Fact>
        {view.skipImmediately === undefined ? null : (
          <Fact name="Skip immediately">{view.skipImmediately ? "Yes" : "No"}</Fact>
        )}
        <Fact name="Backups owned by the schedule">{ownedText(view.owned)}</Fact>
        <Fact name="Created">{time(view.created)}</Fact>
        <Fact name="Installation" note={`Cluster ${installation.cluster.name}`}>
          {view.namespace}
        </Fact>
      </div>
      {isStale(read) ? <Stale kind="schedule" read={read} /> : null}
      {view.notes.length ? (
        <ul className={styles.messages} data-testid="velero-schedule-notes">
          {view.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      {view.validationErrors.length ? (
        <>
          <h3 className={styles.sectionTitle}>Validation errors</h3>
          <ul className={styles.messages} data-testid="velero-schedule-messages">
            {view.validationErrors.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className={styles.sectionTitle}>History</h3>
      {history.state === "listed" ? (
        <div data-testid="velero-schedule-history" data-history="listed">
          <p className={styles.stateText} data-testid="velero-history-counts">
            {countsText(history.counts)}.
          </p>
          <p className={styles.factNote}>
            These are the backups that exist now: one that expired, or that was deleted, is not here.
            {history.stale
              ? ` They were read at ${new Date(backups.lastSuccess ?? 0).toLocaleTimeString()}: the backups could not be read again.`
              : ""}
            {holdsSubmissions(history.items)
              ? " Velero submits no backup of a schedule while one of its backups reports no phase, New or InProgress: one of these does."
              : ""}
          </p>
          <HistoryStrip
            items={history.items}
            now={now}
            shown={shown}
            onOpen={(backup) => openView({ kind: "backup", name: backup })}
            onShow={setShown}
          />
          {shown ? (
            <p className={styles.factNote} data-testid="velero-history-shown">
              The {shown.length} backups of one mark are shown.{" "}
              <button type="button" className={styles.link} onClick={() => setShown(undefined)}>
                Show all
              </button>
            </p>
          ) : null}
          <HistoryList history={history} shown={shown} />
        </div>
      ) : (
        <p className={styles.stateText} data-testid="velero-schedule-history" data-history={history.state}>
          {history.reason}. The history of this schedule is not known, which is not that it has none.
        </p>
      )}

      <h3 className={styles.sectionTitle}>Template</h3>
      <p className={styles.factNote}>What every backup of this schedule is asked, as the schedule carries it.</p>
      <Template
        references={references}
        location={
          location
            ? `${location.status?.phase ?? "availability not reported"}, ${location.spec?.accessMode ?? "access mode not set"}`
            : undefined
        }
      />
      <div className={styles.band} data-testid="velero-schedule-template">
        {backupScope((schedule.spec?.template ?? undefined) as BackupResource["spec"]).map((fact) => (
          <Fact key={fact.id} name={fact.name} note={fact.note}>
            <span data-scope={fact.id}>{fact.value}</span>
          </Fact>
        ))}
      </div>

      <h3 className={styles.sectionTitle}>Restores</h3>
      <p className={styles.stateText}>
        <Restores restores={restores} />
      </p>
      <p className={styles.factNote} data-testid="velero-schedule-restores-note">
        Velero writes the name of a schedule also into a restore asked from one of its backups: a restore that names
        this schedule was asked from it, or from a backup of it.
      </p>
    </Workspace>
  );
});
