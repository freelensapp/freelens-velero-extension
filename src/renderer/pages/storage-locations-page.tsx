import { Renderer } from "@freelensapp/extensions";
import {
  defaults,
  defaultsNote,
  lateNote,
  MAY_BE_OUT_OF_DATE,
  NEVER_VALIDATED,
  storageLocationView,
  syncSummary,
  validationAge,
  validationSummary,
} from "../../common/location-view";
import { timeText } from "../../common/operation-text";
import { BackupStorageLocation } from "../api/kinds";
import { FamilyPage } from "../components/family-page";
import { Availability } from "../components/location-parts";
import { time } from "../components/status";
import styles from "../components/views.module.css";
import { currentInstallation } from "../state/context";
import { OpenView } from "./open-view";

import type { StorageLocationView } from "../../common/location-view";
import type { BackupStorageLocationResource } from "../../common/types";
import type { ListDefinition } from "../components/family-page";
import type { Installation } from "../state/installation";

const {
  Component: { Icon, WithTooltip },
} = Renderer;

function markedText(row: StorageLocationView): string {
  return row.marked ? "Marked default" : "Not marked";
}

export const STORAGE_LOCATIONS: ListDefinition<StorageLocationView> = {
  kind: "storage-location",
  id: "storage-locations",
  object: BackupStorageLocation,
  tableId: "veleroStorageLocationsTable",
  columns: [
    { title: "Name", id: "name", sortBy: "name", className: "name" },
    { title: "Installation", id: "namespace", sortBy: "namespace", className: "installation" },
    { title: "Availability", id: "availability", sortBy: "availability", className: "phase" },
    { title: "Access mode", id: "access", sortBy: "access", className: "access" },
    { title: "Default", id: "marked", sortBy: "marked", className: "marked" },
    { title: "Provider", id: "provider", sortBy: "provider", className: "provider" },
    // The two times are shown by how long ago they were: what is read at a glance is how old they are.
    { title: "Last validation", id: "validated", sortBy: "validated", className: "validated" },
    { title: "Last sync", id: "synced", sortBy: "synced", className: "synced" },
  ],
  view: (resource, now) => storageLocationView(resource as BackupStorageLocationResource, now),
  sorting: {
    name: (row) => row.name,
    namespace: (row) => row.namespace,
    availability: (row) => row.availability.label,
    access: (row) => row.access.label,
    marked: (row) => (row.marked ? 0 : 1),
    provider: (row) => row.provider ?? "",
    validated: (row) => row.validation.at ?? 0,
    synced: (row) => row.sync.last ?? 0,
  },
  // What every column shows, and the message of Velero, which the availability has in its tip.
  search: (row) =>
    [
      row.name,
      row.namespace,
      row.availability.reported ?? "",
      row.availability.label,
      row.message ?? "",
      row.access.written ?? "",
      row.access.label,
      markedText(row),
      row.provider ?? "Not set",
      validationSummary(row.validation),
      row.validation.at === undefined ? "" : timeText(row.validation.at),
      syncSummary(row.sync),
      row.sync.last === undefined ? "" : timeText(row.sync.last),
    ].filter(Boolean),
  // The default of an installation is of the list as a whole: no row says that none is marked.
  notes: (installation) => {
    const read = installation.read("storageLocations");
    const note = defaultsNote(defaults(read.items as BackupStorageLocationResource[], installation.namespace ?? ""));

    return note ? [note] : [];
  },
  cells: (row) => [
    <WithTooltip key="namespace">{row.namespace}</WithTooltip>,
    <Availability key="availability" state={row.availability} of="storage" tip={row.message} />,
    <span key="access" data-access={row.access.mode}>
      {row.access.label}
    </span>,
    <span key="marked" data-default={row.marked}>
      {markedText(row)}
    </span>,
    <WithTooltip key="provider">{row.provider ?? "Not set"}</WithTooltip>,
    // How long ago, which is what is read at a glance: a validation that is old says that what the
    // location reports may not hold any more. When it was is in the tip, and in the view of the location.
    <span
      key="validated"
      className={row.validation.late ? `${styles.status} ${styles.signalWarnings}` : styles.status}
      data-late={row.validation.late}
      // The whole of it for who points at the cell: when it was, and what an old validation means.
      title={
        row.validation.at === undefined
          ? undefined
          : [time(row.validation.at), lateNote(row.validation)].filter(Boolean).join(". ")
      }
    >
      {/* A validation that is late has its mark, which is a shape. Its words are said to who does not see
          the mark, and are in the tip and in the view for who does. */}
      {row.validation.late ? <Icon material="warning_amber" small aria-hidden /> : null}
      <span className={styles.statusText}>
        {row.validation.at === undefined ? NEVER_VALIDATED : validationAge(row.validation)}
        {row.validation.late ? <span className={styles.spoken}>, {MAY_BE_OUT_OF_DATE}</span> : null}
      </span>
    </span>,
    <span key="synced" title={row.sync.last === undefined ? undefined : time(row.sync.last)}>
      {syncSummary(row.sync)}
    </span>,
  ],
};

// The Backup Storage Locations of the selected installation: the list and, over it, the view of what is open.
export function StorageLocationsPage({ installation = currentInstallation() }: { installation?: Installation }) {
  return <FamilyPage definition={STORAGE_LOCATIONS} installation={installation} view={OpenView} />;
}
