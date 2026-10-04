import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { TITLES } from "../../common/discovery";
import { validationSummary } from "../../common/location-view";
import { shownWords } from "../../common/operation-line";
import { durationText, progressText, signalText } from "../../common/operation-text";
import { operationTimeText } from "../../common/operation-time";
import {
  attention,
  attentionSummary,
  COMPLETED_NOTE,
  COVERAGE_WORDS,
  coverage,
  GROUP_TITLES,
  inFlight,
  locationLines,
  newestCompleted,
  recent,
  STALE_WORDS,
  scheduleLines,
  WINDOW_TITLES,
  WINDOWS,
} from "../../common/overview";
import { pausedText } from "../../common/schedule-view";
import { VIEWS } from "../../common/views";
import { Availability } from "../components/location-parts";
import { OperationLines, operationKey } from "../components/operation-lines";
import { Phase, Signal, time } from "../components/status";
import styles from "../components/views.module.css";
import { focusFirst, ViewsFrame } from "../components/views-frame";
import { ViewLink } from "../components/workspace";
import { openView, PAGES, pageUrl } from "../navigation";
import { currentInstallation } from "../state/context";
import { OpenView } from "./open-view";
import { ValidationMark } from "./schedule-workspace";
import { ServerBand } from "./server-band";

import type { ReactNode } from "react";

import type { Unread } from "../../common/location-users";
import type { AttentionItem, NewestCompleted, Operation, OverviewReads, Unchecked } from "../../common/overview";
import type { ViewKind } from "../../common/views";
import type { Installation } from "../state/installation";

const {
  Component: { Icon, MaybeLink },
} = Renderer;

// How many items of a band are shown at once, and how many more each time it is asked: an installation
// of a thousand operations is not drawn whole to say what is first.
const PAGE = 10;

// The first items of a band, and the way to the ones after them.
function More({
  id,
  shown,
  all,
  what,
  onMore,
}: {
  id: string;
  shown: number;
  all: number;
  what: string;
  onMore: () => void;
}) {
  if (shown >= all) return null;
  return (
    <button type="button" className={styles.link} data-testid={`velero-overview-${id}-more`} onClick={onMore}>
      Show {Math.min(PAGE, all - shown)} more of the {all - shown} {what}
    </button>
  );
}

const GROUP_ICONS: Record<AttentionItem["group"], string> = {
  "in-flight": "autorenew",
  storage: "storage",
  schedules: "schedule",
  ended: "highlight_off",
};

interface Ways {
  // The address of the list of a kind.
  list(kind: ViewKind): string;
}

// The way to the list of a kind, which is another page of the extension.
function ListLink({ ways, kind, id, children }: { ways: Ways; kind: ViewKind; id: string; children: ReactNode }) {
  return (
    <MaybeLink to={ways.list(kind)} className={styles.link} data-testid={id}>
      {children}
    </MaybeLink>
  );
}

function Band({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section
      className={styles.overviewBand}
      data-testid={`velero-overview-${id}`}
      aria-labelledby={`velero-overview-${id}-title`}
    >
      <h3 className={styles.sectionTitle} id={`velero-overview-${id}-title`}>
        {title}
      </h3>
      {note ? <p className={styles.factNote}>{note}</p> : null}
      {children}
    </section>
  );
}

function NotRead({ found, what }: { found: Unread; what: string }) {
  return (
    <p className={styles.muted} data-unread={found.state}>
      {found.reason}. {what}
    </p>
  );
}

// When what is shown was read: with its day, which may not be this one.
function ReadBefore({ noun, at }: { noun: string; at?: number }) {
  return (
    <p className={styles.factNote} data-stale="true">
      The {noun} could not be read again: this is what was read at {time(at ?? 0)}.
    </p>
  );
}

// What was read: a number for each family that was read, its state for one that was not. Each leads to
// its list.
function WhatWasRead({ reads, ways }: { reads: OverviewReads; ways: Ways }) {
  return (
    <section className={styles.overviewRead} data-testid="velero-overview-read" aria-label="What was read">
      {coverage(reads).map((found) => (
        <MaybeLink
          key={found.family}
          to={ways.list(found.kind)}
          className={styles.overviewCell}
          data-testid={`velero-overview-read-${found.family}`}
          data-read={found.state}
        >
          <span className={styles.factName}>{TITLES[found.family]}</span>
          <span className={styles.overviewCount}>
            {found.state === "read" || found.state === "stale" ? found.count : COVERAGE_WORDS[found.state]}
          </span>
          {found.state === "stale" ? (
            <span className={styles.factNote}>
              Read at {time(found.at)}: {STALE_WORDS[found.status] ?? STALE_WORDS.failed}
            </span>
          ) : null}
        </MaybeLink>
      ))}
    </section>
  );
}

function Item({ item, ways }: { item: AttentionItem; ways: Ways }) {
  return (
    <li className={styles.overviewItem} data-rule={item.rule} data-group={item.group} data-stale={item.stale}>
      <Icon material={GROUP_ICONS[item.group]} small aria-hidden />
      <div>
        <div>
          <span className={styles.muted}>{GROUP_TITLES[item.group]}: </span>
          {item.name ? (
            <ViewLink target={{ kind: item.kind, name: item.name }} />
          ) : (
            <ListLink ways={ways} kind={item.kind} id={`velero-overview-item-${item.rule}-list`}>
              {item.title}
            </ListLink>
          )}
          {item.time === undefined ? null : <span className={styles.muted}> {time(item.time)}</span>}
        </div>
        <div className={styles.factNote}>
          {item.reason}
          {item.related ? (
            <>
              {" "}
              <ViewLink target={item.related} />
            </>
          ) : null}
          {item.stale ? " It was read before the last read, which did not succeed." : ""}
        </div>
      </div>
    </li>
  );
}

function NotChecked({ line, ways }: { line: Unchecked; ways: Ways }) {
  return (
    <li className={styles.overviewItem} data-unchecked={line.family}>
      <Icon material="help_outline" small aria-hidden />
      <div>
        <ListLink ways={ways} kind={line.kind} id={`velero-overview-unchecked-${line.family}`}>
          {TITLES[line.family]}
        </ListLink>
        <div className={styles.factNote}>
          {line.reason}. {line.missing}.
        </div>
      </div>
    </li>
  );
}

// The newest backup that completed. Where it is not known, why is said in words where there is the room
// for them, which the band has and a line of a schedule has not: there it is what the words say to who
// points at them, and what the page says of the backups over the lines.
function Completed({ found, reason = false }: { found: NewestCompleted; reason?: boolean }) {
  if (found.state === "found") {
    return (
      <span data-completed="found">
        <ViewLink target={{ kind: "backup", name: found.backup.name }} />
        <span className={styles.muted}>
          {" "}
          {found.completed === undefined ? "completion time not reported" : `completed ${time(found.completed)}`}
          {found.stale ? ", as read before the last read, which did not succeed" : ""}
        </span>
      </span>
    );
  }
  if (found.state === "none") {
    return (
      <span data-completed="none">
        None among the backups that exist
        {found.stale ? ", as they were read before the last read, which did not succeed" : ""}
      </span>
    );
  }
  return (
    <span className={styles.muted} data-completed={found.state} title={found.reason}>
      Not known{reason ? `: ${found.reason.charAt(0).toLowerCase()}${found.reason.slice(1)}` : ""}
    </span>
  );
}

// The time of an operation with which of its times it is: a time of creation is not shown as a start.
function timeOf({ view, time: when }: Operation): string {
  return when.of === "none"
    ? "Not reported"
    : `${time(when.time)} (${operationTimeText(when, view.state.execution).toLowerCase()})`;
}

// The operations in flight, in the half of the page their band has. Each one is two lines: its name, its
// kind and for how long it has been at work, then where it is, what it carries and how many of its items
// are done. When it started is what the elapsed time says to who points at it. A table of as many columns
// would break every phase of many words in a band of this width.
function Flights({ items }: { items: Operation[] }) {
  return (
    <ul className={styles.flights} data-testid="velero-overview-in-flight-list">
      {items.map((operation) => {
        const { view, kind, time: when } = operation;

        return (
          <li key={operationKey(operation)} className={styles.flight} data-operation={operationKey(operation)}>
            <div className={styles.flightHead}>
              <span>
                <ViewLink target={{ kind, name: view.name }} />{" "}
                <span className={styles.muted} data-part="kind">
                  {VIEWS[kind].noun}
                </span>
              </span>
              <span className={styles.short} data-part="elapsed" data-time={when.of} title={timeOf(operation)}>
                {durationText(view.duration)}
              </span>
            </div>
            <div className={styles.flightFacts}>
              <span data-part="phase">
                <Phase state={view.state} />
              </span>
              <span data-part="failure">
                <Signal evidence={view.evidence} title={signalText(view.evidence)} />
              </span>
              <span data-part="progress">
                <span className={styles.muted}>Items: </span>
                {progressText(view.progress)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// The operations of the window, in a band that has the page: a row for each, a column for each fact.
function Operations({ items, id }: { items: Operation[]; id: string }) {
  return (
    <div className={styles.scrolled}>
      <table className={styles.references} data-testid={id}>
        <thead>
          <tr>
            <th scope="col">Operation</th>
            <th scope="col">Kind</th>
            <th scope="col">Phase</th>
            <th scope="col">Failure</th>
            <th scope="col">Progress</th>
            <th scope="col">Time</th>
            <th scope="col">Duration</th>
          </tr>
        </thead>
        <tbody>
          {items.map((operation) => {
            const { view, kind, time: when } = operation;

            return (
              <tr key={operationKey(operation)} data-operation={operationKey(operation)}>
                <td>
                  <ViewLink target={{ kind, name: view.name }} />
                </td>
                <td className={styles.short}>{VIEWS[kind].noun}</td>
                <td>
                  <Phase state={view.state} />
                </td>
                <td>
                  <Signal evidence={view.evidence} title={signalText(view.evidence)} />
                </td>
                <td className={styles.short}>{progressText(view.progress)}</td>
                <td data-time={when.of}>
                  {when.of === "none" ? (
                    timeOf(operation)
                  ) : (
                    <>
                      {/* The time and which of the two it is are each on one line, and one under the
                          other where the column is narrow. */}
                      <span className={styles.short}>{time(when.time)}</span>{" "}
                      <span className={styles.short}>
                        ({operationTimeText(when, view.state.execution).toLowerCase()})
                      </span>
                    </>
                  )}
                </td>
                <td className={styles.short}>{durationText(view.duration)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export interface OverviewProps {
  installation: Installation;
  now: number;
  ways: Ways;
}

// The page of an installation: what was read of it, what needs attention, what is in flight, how the last
// operations went. It asks the cluster nothing of its own, and gives no value for the installation as a
// whole: every number says what it counts.
export const Overview = observer(({ installation, now, ways }: OverviewProps) => {
  // What was read of each family, with what the cluster says that it serves: as every view reads it.
  const reads: OverviewReads = {
    backups: installation.read("backups"),
    restores: installation.read("restores"),
    schedules: installation.read("schedules"),
    storageLocations: installation.read("storageLocations"),
    snapshotLocations: installation.read("snapshotLocations"),
  };
  const window = installation.window;
  const [shown, setShown] = React.useState<string[]>();
  const [pages, setPages] = React.useState(1);
  const [attended, setAttended] = React.useState(1);
  const [flown, setFlown] = React.useState(1);
  const namespace = installation.namespace ?? "";

  // Another window, and another installation, hold other operations: what was shown alone is not of them.
  React.useEffect(() => {
    setShown(undefined);
    setPages(1);
  }, [window, namespace]);
  React.useEffect(() => {
    setAttended(1);
    setFlown(1);
  }, [namespace]);
  const found = attention(reads, now, window);
  const flying = inFlight(reads, now);
  const last = recent(reads, now, window);
  const completed = newestCompleted(reads.backups, now);
  const schedules = scheduleLines(reads, now, found);
  const locations = locationLines(reads, now, found);
  const chosen = shown ? new Set(shown) : undefined;
  const listed = chosen ? last.items.filter((operation) => chosen.has(operationKey(operation))) : last.items;
  const visible = listed.slice(0, pages * PAGE);

  return (
    <div className={styles.overview} data-testid="velero-overview">
      <WhatWasRead reads={reads} ways={ways} />

      <Band id="server" title="Server">
        <ServerBand installation={installation} />
      </Band>

      <div className={styles.overviewRow}>
        <Band id="attention" title="Needs attention">
          <p className={styles.stateText} data-testid="velero-overview-attention-summary">
            {attentionSummary(found)}
          </p>
          {found.items.length || found.unchecked.length ? (
            <ul className={styles.overviewItems}>
              {/* What could not be checked is said first: it is what the items that follow do not cover. */}
              {found.unchecked.map((line) => (
                <NotChecked key={line.family} line={line} ways={ways} />
              ))}
              {found.items.slice(0, attended * PAGE).map((item) => (
                <Item key={`${item.rule}/${item.kind}/${item.name ?? ""}`} item={item} ways={ways} />
              ))}
            </ul>
          ) : null}
          <More
            id="attention"
            shown={attended * PAGE}
            all={found.items.length}
            what="items that follow"
            onMore={() => setAttended(attended + 1)}
          />
        </Band>

        <div>
          <Band id="completed" title="Newest completed backup" note={COMPLETED_NOTE}>
            <p className={styles.stateText}>
              <Completed found={completed} reason />
            </p>
          </Band>

          <Band id="in-flight" title="In flight">
            {flying.items.length ? (
              <>
                <p className={styles.factNote} data-testid="velero-overview-in-flight-count">
                  {flying.items.length} in flight, from the oldest.
                </p>
                <Flights items={flying.items.slice(0, flown * PAGE)} />
                <More
                  id="in-flight"
                  shown={flown * PAGE}
                  all={flying.items.length}
                  what="newer ones"
                  onMore={() => setFlown(flown + 1)}
                />
              </>
            ) : flying.backups.state === "listed" && flying.restores.state === "listed" ? (
              <p className={styles.stateText} data-testid="velero-overview-in-flight-none">
                No backup and no restore is in flight.
              </p>
            ) : flying.backups.state === "listed" || flying.restores.state === "listed" ? (
              // Of the kind that was read it is known, and said: of the other it is not.
              <p className={styles.stateText} data-testid="velero-overview-in-flight-none-of-one">
                No {flying.backups.state === "listed" ? "backup" : "restore"} is in flight.
              </p>
            ) : null}
            {flying.backups.state === "listed" ? null : (
              <NotRead found={flying.backups} what="Whether a backup is in flight is not known." />
            )}
            {flying.restores.state === "listed" ? null : (
              <NotRead found={flying.restores} what="Whether a restore is in flight is not known." />
            )}
            {flying.backups.state === "listed" && flying.backups.stale ? (
              <ReadBefore noun="backups" at={flying.backups.at} />
            ) : null}
            {flying.restores.state === "listed" && flying.restores.stale ? (
              <ReadBefore noun="restores" at={flying.restores.at} />
            ) : null}
          </Band>
        </div>
      </div>

      <Band id="recent" title="Recent operations">
        <fieldset className={styles.overviewWindows} data-testid="velero-overview-windows">
          <legend className={styles.spoken}>How far back the recent operations go</legend>
          {WINDOWS.map((choice) => (
            <button
              key={choice}
              type="button"
              className={`${styles.overviewWindow} ${choice === window ? styles.overviewWindowChosen : ""}`}
              aria-pressed={choice === window}
              data-testid={`velero-overview-window-${choice}`}
              onClick={() => installation.chooseWindow(choice)}
            >
              {WINDOW_TITLES[choice]}
            </button>
          ))}
        </fieldset>
        <OperationLines
          rows={[
            { id: "backups", title: "Backups", noun: "backup", operations: last.backups },
            { id: "restores", title: "Restores", noun: "restore", operations: last.restores },
          ]}
          from={last.from}
          now={now}
          window={WINDOW_TITLES[window]}
          shown={shown}
          onOpen={(operation) => openView({ kind: operation.kind, name: operation.view.name })}
          onShow={(keys) => {
            setShown(keys);
            setPages(1);
          }}
        />
        {shown ? (
          <p className={styles.factNote} data-testid="velero-overview-shown">
            {/* The ones that are shown now: one of them may be gone since the mark was chosen, or be older
                than the window, which moves with the clock. */}
            <span role="status">
              {shownWords(listed.length, "operation", `the ones of the last ${WINDOW_TITLES[window]} that exist now`)}
            </span>{" "}
            <button
              type="button"
              className={styles.link}
              onClick={(event) => {
                // The button goes away with what it says: the focus goes to the mark that was chosen, or
                // to the window when the mark is not there any more.
                const band = event.currentTarget.closest<HTMLElement>('[data-testid="velero-overview-recent"]');

                focusFirst(band, [
                  '[data-line-mark][aria-pressed="true"]',
                  '[data-testid="velero-overview-windows"] [aria-pressed="true"]',
                ]);
                setShown(undefined);
              }}
            >
              Show all
            </button>
          </p>
        ) : null}
        {last.untimed ? (
          <p className={styles.factNote} data-testid="velero-overview-untimed">
            {last.untimed === 1
              ? "One operation reports no time, and no window holds what has none: it is in the list of its kind."
              : `${last.untimed} operations report no time, and no window holds what has none: they are in the lists of their kinds.`}
          </p>
        ) : null}
        {visible.length ? <Operations items={visible} id="velero-overview-recent-list" /> : null}
        <More
          id="recent"
          shown={visible.length}
          all={listed.length}
          what="older ones"
          onMore={() => setPages(pages + 1)}
        />
      </Band>

      <div className={styles.overviewRow}>
        <Band id="schedules" title="Schedules">
          {schedules.state === "listed" ? (
            <>
              {schedules.items.length ? (
                <div className={styles.scrolled}>
                  <table className={styles.references} data-testid="velero-overview-schedules-list">
                    <thead>
                      <tr>
                        <th scope="col">Schedule</th>
                        <th scope="col">Validation</th>
                        <th scope="col">Paused</th>
                        <th scope="col">Newest completed backup</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedules.items.map((line) => (
                        <tr
                          key={line.view.uid ?? line.view.name}
                          data-line={line.view.name}
                          data-rules={line.rules.join(" ")}
                        >
                          <td>
                            <ViewLink target={{ kind: "schedule", name: line.view.name }} />
                          </td>
                          <td>
                            <ValidationMark state={line.view.state} />
                          </td>
                          <td className={styles.short}>{pausedText(line.view.paused)}</td>
                          <td>
                            <Completed found={line.newestCompleted} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.stateText}>No schedule is in this installation.</p>
              )}
              {schedules.others ? (
                <p className={styles.factNote} data-testid="velero-overview-schedules-others">
                  {schedules.others} more{" "}
                  <ListLink ways={ways} kind="schedule" id="velero-overview-schedules-all">
                    in the list of the schedules
                  </ListLink>
                </p>
              ) : null}
              {schedules.stale ? <ReadBefore noun="schedules" at={reads.schedules.lastSuccess} /> : null}
            </>
          ) : (
            <NotRead found={schedules} what="The schedules of this installation are not known." />
          )}
        </Band>

        <Band id="storage" title="Storage">
          {locations.state === "listed" ? (
            <>
              {locations.items.length ? (
                <div className={styles.scrolled}>
                  <table className={styles.references} data-testid="velero-overview-storage-list">
                    <thead>
                      <tr>
                        <th scope="col">Storage location</th>
                        <th scope="col">Availability</th>
                        <th scope="col">Access mode</th>
                        <th scope="col">Default</th>
                        <th scope="col">Last validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locations.items.map((line) => (
                        <tr
                          key={line.view.uid ?? line.view.name}
                          data-line={line.view.name}
                          data-rules={line.rules.join(" ")}
                        >
                          <td>
                            <ViewLink target={{ kind: "storage-location", name: line.view.name }} />
                          </td>
                          <td>
                            <Availability state={line.view.availability} of="storage" tip={line.view.message} />
                          </td>
                          <td className={styles.short}>{line.view.access.label}</td>
                          <td className={styles.short}>{line.view.marked ? "Marked default" : "Not marked"}</td>
                          <td data-late={line.view.validation.late}>{validationSummary(line.view.validation)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.stateText}>No storage location is in this installation.</p>
              )}
              {locations.others ? (
                <p className={styles.factNote} data-testid="velero-overview-storage-others">
                  {locations.others} more{" "}
                  <ListLink ways={ways} kind="storage-location" id="velero-overview-storage-all">
                    in the list of the storage locations
                  </ListLink>
                </p>
              ) : null}
              {locations.stale ? <ReadBefore noun="storage locations" at={reads.storageLocations.lastSuccess} /> : null}
            </>
          ) : (
            <NotRead found={locations} what="The storage locations of this installation are not known." />
          )}
        </Band>
      </div>
    </div>
  );
});

export interface OverviewPageProps {
  extension: { name: string };
  installation?: Installation;
}

// The Overview of the selected installation and, over it, the view of what is open.
export function OverviewPage({ extension, installation = currentInstallation() }: OverviewPageProps) {
  const ways: Ways = { list: (kind) => pageUrl(extension.name, PAGES[kind]) };

  return (
    <ViewsFrame
      id="overview"
      title="Overview"
      installation={installation}
      // What was read of each family is a band of the page: nothing is said of them over it.
      families={[]}
      view={OpenView}
      origin={(root, target) =>
        root.querySelector<HTMLElement>(`[data-testid="velero-open-${target.kind}-${target.name}"]`) ?? undefined
      }
    >
      {(now) => <Overview installation={installation} now={now} ways={ways} />}
    </ViewsFrame>
  );
}
