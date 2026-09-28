import { Renderer } from "@freelensapp/extensions";
import { MAY_BE_SENT_BY_DEFAULT, SENT_BY_DEFAULT, usingBackupsText } from "../../common/location-users";
import { availabilityMark, LEFT_OUT, referenceText } from "../../common/location-view";
import { signalText } from "../../common/operation-text";
import { Signal } from "./status";
import styles from "./views.module.css";
import { Fact, ViewLink } from "./workspace";

import type { LocationKind, LocationUsers, UsingSchedules } from "../../common/location-users";
import type { AvailabilityMark, AvailabilityState, ConfigEntry, Reference } from "../../common/location-view";

const {
  Component: { Icon },
} = Renderer;

const MARK_ICONS: Record<AvailabilityMark, string> = {
  available: "check_circle_outline",
  unavailable: "highlight_off",
  unknown: "help_outline",
};
const MARK_STYLES: Record<AvailabilityMark, string> = {
  available: "",
  unavailable: styles.signalFailure,
  unknown: styles.signalUnknown,
};

export interface AvailabilityProps {
  state: AvailabilityState;
  of: LocationKind;
  // What is read of the mark by who points at it: what Velero says beside the phase, where it says something.
  tip?: string;
}

// What is said of whether a location can be used: a mark and a word, which a color alone would not say.
// Nothing but a reported Available of a storage location has the mark of what is available.
export function Availability({ state, of, tip }: AvailabilityProps) {
  const mark = availabilityMark(state, of);

  return (
    <span
      className={`${styles.status} ${MARK_STYLES[mark]}`}
      title={tip ?? state.reported ?? state.label}
      data-availability={state.availability}
      data-mark={mark}
    >
      <Icon material={MARK_ICONS[mark]} small aria-hidden />
      <span className={styles.statusText}>{state.label}</span>
    </span>
  );
}

// Every key of the configuration of a location, as the object carries it.
export function Configuration({ entries }: { entries: ConfigEntry[] }) {
  if (!entries.length) {
    return (
      <p className={styles.stateText} data-testid="velero-location-config" data-config="none">
        The location carries no configuration.
      </p>
    );
  }
  return (
    <>
      <table className={styles.references} data-testid="velero-location-config" data-config="listed">
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.key} data-config-key={entry.key}>
              <th scope="row">{entry.key}</th>
              <td>
                <code>{entry.value}</code>
                {entry.mark ? (
                  <div className={styles.warning} role="note" data-testid="velero-location-unverified">
                    <Icon material="warning_amber" small aria-hidden /> {entry.mark}
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.some((entry) => entry.shortened) ? (
        <p className={styles.factNote} data-testid="velero-location-left-out">
          {LEFT_OUT}
        </p>
      ) : null}
    </>
  );
}

// A Secret a location refers to, by its name and the name of its key: no Secret is read.
export function SecretReference({ name, reference }: { name: string; reference?: Reference }) {
  return (
    <Fact name={name} note={reference ? "The Secret is named, and is not read." : undefined}>
      <span data-secret={reference ? "named" : "none"}>{referenceText(reference)}</span>
    </Fact>
  );
}

// The schedules of a part of what uses a location, each a way to its view, or what is known of them.
function Schedules({ schedules, none, unknown }: { schedules: UsingSchedules; none: string; unknown: string }) {
  if (schedules.state !== "listed") {
    return (
      <span className={styles.muted}>
        {schedules.reason}. {unknown}
      </span>
    );
  }
  return (
    <>
      {schedules.names.length
        ? schedules.names.map((name, index) => (
            <span key={name}>
              {index ? ", " : ""}
              <ViewLink target={{ kind: "schedule", name }} />
            </span>
          ))
        : none}
      {schedules.stale ? <span className={styles.muted}> (read before the schedules stopped answering)</span> : null}
    </>
  );
}

// What uses a location: the backups that name it, counted by how they ended, with the newest of them, and
// the schedules whose template names it. What could not be read is not known, which is not none.
export function UsedBy({ users }: { users: LocationUsers }) {
  const { backups, schedules, byDefault } = users;

  return (
    <table className={styles.references} data-testid="velero-location-users">
      <tbody>
        <tr>
          <th scope="row">Backups</th>
          <td data-testid="velero-location-backups" data-users={backups.state}>
            {backups.state === "listed" ? (
              <>
                <span data-testid="velero-location-backups-counts">{usingBackupsText(backups.counts)}.</span>
                {backups.newest ? (
                  <span data-testid="velero-location-newest">
                    {" "}
                    The newest is <ViewLink target={{ kind: "backup", name: backups.newest.view.name }} />{" "}
                    <Signal evidence={backups.newest.view.evidence} title={signalText(backups.newest.view.evidence)} />
                  </span>
                ) : null}
                {backups.stale ? (
                  <span className={styles.muted}> (read before the backups stopped answering)</span>
                ) : null}
              </>
            ) : (
              <span className={styles.muted}>
                {backups.reason}. Which backups name this location is not known, which is not that none does.
              </span>
            )}
          </td>
        </tr>
        <tr>
          <th scope="row">Schedules</th>
          <td data-testid="velero-location-schedules" data-users={schedules.state}>
            <Schedules
              schedules={schedules}
              none="No schedule names this location in its template"
              unknown="Which schedules name this location is not known, which is not that none does."
            />
          </td>
        </tr>
        {byDefault ? (
          <tr>
            <th scope="row">Schedules that name no location</th>
            <td data-testid="velero-location-by-default" data-users={byDefault.schedules.state}>
              <Schedules
                schedules={byDefault.schedules}
                none="Every schedule names a location in its template"
                unknown="Which schedules name no location is not known."
              />
              {byDefault.schedules.state === "listed" && byDefault.schedules.names.length ? (
                <div className={styles.factNote} data-testid="velero-location-by-default-note">
                  {byDefault.certain ? SENT_BY_DEFAULT : MAY_BE_SENT_BY_DEFAULT}
                </div>
              ) : null}
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}
