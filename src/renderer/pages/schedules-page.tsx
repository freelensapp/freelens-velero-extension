import { Renderer } from "@freelensapp/extensions";
import { signalText, timeText } from "../../common/operation-text";
import { scheduleHistory } from "../../common/schedule-history";
import { adherenceOrder, scheduleSignal } from "../../common/schedule-signal";
import { pausedText, scheduleView } from "../../common/schedule-view";
import { Schedule } from "../api/kinds";
import { AdherenceCell, NextRunText } from "../components/adherence";
import { FamilyPage } from "../components/family-page";
import { Signal, time } from "../components/status";
import styles from "../components/views.module.css";
import { adherenceOf, backupsAnswered } from "../state/adherence";
import { currentInstallation } from "../state/context";
import { OpenView } from "./open-view";
import { ValidationMark } from "./schedule-workspace";

import type { HistoryItem } from "../../common/schedule-history";
import type { NextRun, ScheduleSignal } from "../../common/schedule-signal";
import type { ScheduleView } from "../../common/schedule-view";
import type { ScheduleResource } from "../../common/types";
import type { ListDefinition } from "../components/family-page";
import type { Installation } from "../state/installation";

const {
  Component: { KubeObjectAge, WithTooltip },
} = Renderer;

// What a row of the list shows: the schedule, and the newest of its backups that exist, or that its backups
// are not known; and its adherence, as the views share it for a read and a tick of their clock, which is
// nothing while the backups of the installation were never answered.
export interface ScheduleRow extends ScheduleView {
  newest: { known: true; item?: HistoryItem } | { known: false; reason: string };
  adherence?: ScheduleSignal;
}

export function scheduleRow(resource: ScheduleResource, now: number, installation: Installation): ScheduleRow {
  const history = scheduleHistory(resource, installation.read("backups"), now);

  return {
    ...scheduleView(resource),
    newest:
      history.state === "listed" ? { known: true, item: history.items[0] } : { known: false, reason: history.reason },
    ...(backupsAnswered(installation) ? { adherence: scheduleSignal(resource, adherenceOf(installation, now)) } : {}),
  };
}

function newestText(row: ScheduleRow): string {
  if (!row.newest.known) return "Not known";
  return row.newest.item ? row.newest.item.view.name : "None that exists";
}

// The order by the next run (REQ-168): the instants first, from the earliest, then the runs that are not known,
// then the schedules that have none, each by name. The host reverses the whole in the second order a click
// gives: no callback knows the direction it is asked for, and the ones that have none come first then.
const RANKS: Record<NextRun["kind"], number> = { at: 0, "not-known": 1, none: 2 };

function nextOrder(row: ScheduleRow): [number, number, string] {
  const next = row.adherence?.next;

  if (!next) return [RANKS["not-known"], 0, row.name];
  return [RANKS[next.kind], next.kind === "at" ? next.at : 0, row.name];
}

export const SCHEDULES: ListDefinition<ScheduleRow> = {
  kind: "schedule",
  id: "schedules",
  object: Schedule,
  tableId: "veleroSchedulesTable",
  // The newest backup of each schedule is read from the backups, and so is its adherence.
  uses: ["backups"],
  columns: [
    { title: "Name", id: "name", sortBy: "name", className: "name" },
    { title: "Installation", id: "namespace", sortBy: "namespace", className: "installation" },
    { title: "Schedule", id: "schedule", sortBy: "schedule", className: "schedule" },
    { title: "Paused", id: "paused", sortBy: "paused", className: "paused" },
    { title: "Next run", id: "next", sortBy: "next", className: "next" },
    { title: "Adherence", id: "adherence", sortBy: "adherence", className: "adherence" },
    { title: "Last submission", id: "submitted", sortBy: "submitted", className: "submitted" },
    { title: "Newest backup", id: "newest", sortBy: "newest", className: "newest" },
    { title: "Validation", id: "validation", sortBy: "validation", className: "phase" },
    { title: "Age", id: "age", sortBy: "age", className: "age" },
  ],
  view: (resource, now, installation) => scheduleRow(resource as ScheduleResource, now, installation),
  sorting: {
    name: (row) => row.name,
    namespace: (row) => row.namespace,
    schedule: (row) => row.expression.written ?? "",
    paused: (row) => row.paused,
    next: nextOrder,
    // By the weight of the state, then the expected run, the earliest first, then the name. While the backups
    // were never answered no row has an adherence, and the column orders by the name.
    adherence: (row) => (row.adherence ? adherenceOrder(row.adherence, row.name) : row.name),
    submitted: (row) => row.lastSubmission ?? 0,
    newest: (row) => (row.newest.known && row.newest.item?.time.of !== "none" ? (row.newest.item?.time.time ?? 0) : 0),
    validation: (row) => row.state.label,
    age: (row) => -(row.created ?? 0),
  },
  // What every column shows but the age, which the host writes, and the words of the validation; of the
  // adherence the word of the state, the text of the next run and what is said beside the state.
  search: (row) =>
    [
      row.name,
      row.namespace,
      row.expression.written ?? "",
      pausedText(row.paused),
      ...(row.adherence ? [row.adherence.label, row.adherence.next.text, ...row.adherence.notes] : []),
      timeText(row.lastSubmission),
      newestText(row),
      row.newest.known && row.newest.item ? signalText(row.newest.item.view.evidence) : "",
      row.state.reported ?? "",
      row.state.label,
      ...row.validationErrors,
    ].filter(Boolean),
  // A clock of the cluster that is ahead of this machine is said of the list as a whole, as an object of the
  // installation shows it.
  notes: (installation, now) => {
    if (!backupsAnswered(installation)) return [];
    const { clocks } = adherenceOf(installation, now);

    return clocks.ahead > 0 ? [clocks.words] : [];
  },
  cells: (row, item) => [
    <WithTooltip key="namespace">{row.namespace}</WithTooltip>,
    <WithTooltip key="schedule">{row.expression.written ?? "Not reported"}</WithTooltip>,
    <span key="paused" data-paused={row.paused}>
      {pausedText(row.paused)}
    </span>,
    // Nothing is said of the adherence before the backups were answered once: the cells are there, and empty,
    // so that every other cell stays under its column.
    row.adherence ? <NextRunText key="next" next={row.adherence.next} /> : <span key="next" />,
    row.adherence ? <AdherenceCell key="adherence" signal={row.adherence} /> : <span key="adherence" />,
    // A submission is a backup that was asked for: how it ended is in the column beside it.
    <WithTooltip key="submitted" tooltip={row.lastSubmission === undefined ? undefined : new Date(row.lastSubmission)}>
      {time(row.lastSubmission)}
    </WithTooltip>,
    <span key="newest" className={styles.newest} data-newest={row.newest.known ? "known" : "unknown"}>
      <span className={styles.statusText} title={row.newest.known ? newestText(row) : row.newest.reason}>
        {newestText(row)}
      </span>
      {row.newest.known && row.newest.item ? (
        <Signal evidence={row.newest.item.view.evidence} title={signalText(row.newest.item.view.evidence)} />
      ) : null}
    </span>,
    <ValidationMark key="validation" state={row.state} />,
    <KubeObjectAge key="age" object={item} />,
  ],
};

// The Schedules of the selected installation: the list and, over it, the view of what is open.
export function SchedulesPage({ installation = currentInstallation() }: { installation?: Installation }) {
  return <FamilyPage definition={SCHEDULES} installation={installation} view={OpenView} />;
}
