import { Renderer } from "@freelensapp/extensions";
import { snapshotLocationView } from "../../common/location-view";
import { VolumeSnapshotLocation } from "../api/kinds";
import { FamilyPage } from "../components/family-page";
import { Availability } from "../components/location-parts";
import { currentInstallation } from "../state/context";
import { OpenView } from "./open-view";

import type { SnapshotLocationView } from "../../common/location-view";
import type { VolumeSnapshotLocationResource } from "../../common/types";
import type { ListDefinition } from "../components/family-page";
import type { Installation } from "../state/installation";

const {
  Component: { KubeObjectAge, WithTooltip },
} = Renderer;

export const SNAPSHOT_LOCATIONS: ListDefinition<SnapshotLocationView> = {
  kind: "snapshot-location",
  id: "snapshot-locations",
  object: VolumeSnapshotLocation,
  tableId: "veleroSnapshotLocationsTable",
  columns: [
    { title: "Name", id: "name", sortBy: "name", className: "name" },
    { title: "Installation", id: "namespace", sortBy: "namespace", className: "installation" },
    { title: "Provider", id: "provider", sortBy: "provider", className: "provider" },
    { title: "Phase", id: "availability", sortBy: "availability", className: "phase" },
    { title: "Age", id: "age", sortBy: "age", className: "age" },
  ],
  view: (resource) => snapshotLocationView(resource as VolumeSnapshotLocationResource),
  sorting: {
    name: (row) => row.name,
    namespace: (row) => row.namespace,
    provider: (row) => row.provider ?? "",
    availability: (row) => row.phase.label,
    age: (row) => -(row.created ?? 0),
  },
  // What every column shows but the age, which the host writes.
  search: (row) =>
    [row.name, row.namespace, row.provider ?? "Not set", row.phase.reported ?? "", row.phase.label].filter(Boolean),
  // The reviewed release neither writes nor checks the phase of these: it is said once, over the list.
  notes: () => [
    "The reviewed release neither writes nor checks the phase of a volume snapshot location: a phase that is here says nothing of whether the location can be used.",
  ],
  cells: (row, item) => [
    <WithTooltip key="namespace">{row.namespace}</WithTooltip>,
    <WithTooltip key="provider">{row.provider ?? "Not set"}</WithTooltip>,
    <Availability key="availability" state={row.phase} of="snapshot" />,
    <KubeObjectAge key="age" object={item} />,
  ],
};

// The Volume Snapshot Locations of the selected installation: the list and, over it, the view of what is
// open.
export function SnapshotLocationsPage({ installation = currentInstallation() }: { installation?: Installation }) {
  return <FamilyPage definition={SNAPSHOT_LOCATIONS} installation={installation} view={OpenView} />;
}
