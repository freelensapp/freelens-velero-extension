import { Renderer } from "@freelensapp/extensions";
import { signalText, timeText } from "../../common/operation-text";
import { scheduleHistory } from "../../common/schedule-history";
import { pausedText, scheduleView } from "../../common/schedule-view";
import { Schedule } from "../api/kinds";
import { FamilyPage } from "../components/family-page";
import { Signal, time } from "../components/status";
import styles from "../components/views.module.css";
import { currentInstallation } from "../state/context";
import { OpenView } from "./open-view";
import { ValidationMark } from "./schedule-workspace";

import type { HistoryItem } from "../../common/schedule-history";
import type { ScheduleView } from "../../common/schedule-view";
import type { ScheduleResource } from "../../common/types";
import type { ListDefinition } from "../components/family-page";
import type { Installation } from "../state/installation";

const {
  Component: { KubeObjectAge, WithTooltip },
} = Renderer;

// What a row of the list shows: the schedule, and the newest of its backups that exist, or that its backups
// are not known.
export interface ScheduleRow extends ScheduleView {
  newest: { known: true; item?: HistoryItem } | { known: false; reason: string };
}

export function scheduleRow(resource: ScheduleResource, now: number, installation: Installation): ScheduleRow {
  const history = scheduleHistory(resource, installation.read("backups"), now);

  return {
    ...scheduleView(resource),
    newest:
      history.state === "listed" ? { known: true, item: history.items[0] } : { known: false, reason: history.reason },
  };
}

function newestText(row: ScheduleRow): string {
  if (!row.newest.known) return "Not known";
  return row.newest.item ? row.newest.item.view.name : "None that exists";
}

export const SCHEDULES: ListDefinition<ScheduleRow> = {
  kind: "schedule",
  id: "schedules",
  object: Schedule,
  tableId: "veleroSchedulesTable",
  // The newest backup of each schedule is read from the backups.
  uses: ["backups"],
  columns: [
    { title: "Name", id: "name", sortBy: "name", className: "name" },
    { title: "Installation", id: "namespace", sortBy: "namespace", className: "installation" },
    { title: "Schedule", id: "schedule", sortBy: "schedule", className: "schedule" },
    { title: "Paused", id: "paused", sortBy: "paused", className: "paused" },
    { title: "Last submission", id: "submitted", sortBy: "submitted", className: "started" },
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
    submitted: (row) => row.lastSubmission ?? 0,
    newest: (row) => (row.newest.known && row.newest.item?.time.of !== "none" ? (row.newest.item?.time.time ?? 0) : 0),
    validation: (row) => row.state.label,
    age: (row) => -(row.created ?? 0),
  },
  // What every column shows but the age, which the host writes, and the words of the validation.
  search: (row) =>
    [
      row.name,
      row.namespace,
      row.expression.written ?? "",
      pausedText(row.paused),
      timeText(row.lastSubmission),
      newestText(row),
      row.newest.known && row.newest.item ? signalText(row.newest.item.view.evidence) : "",
      row.state.reported ?? "",
      row.state.label,
      ...row.validationErrors,
    ].filter(Boolean),
  cells: (row, item) => [
    <WithTooltip key="namespace">{row.namespace}</WithTooltip>,
    <WithTooltip key="schedule">{row.expression.written ?? "Not reported"}</WithTooltip>,
    <span key="paused" data-paused={row.paused}>
      {pausedText(row.paused)}
    </span>,
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
