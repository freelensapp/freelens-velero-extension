import { Renderer } from "@freelensapp/extensions";
import { resolveReference } from "../../common/references";
import {
  REPOSITORY_SORTING,
  repositoryFrequencyText,
  repositorySearch,
  repositoryView,
} from "../../common/repository-view";
import { writtenType } from "../../common/volume-phases";
import { agoText, NOT_WRITTEN, REPOSITORY_WORDS } from "../../common/volume-words";
import { BackupRepository } from "../api/kinds";
import { FamilyPage } from "../components/family-page";
import styles from "../components/views.module.css";
import { CellWay, FailedMaintenanceMark, RepositoryReadinessMark, WrittenValue } from "../components/volume-status";
import { currentInstallation } from "../state/context";
import { OpenView } from "./open-view";

import type { Reference } from "../../common/references";
import type { RepositoryView } from "../../common/repository-view";
import type { BackupRepositoryResource } from "../../common/types";
import type { ListDefinition } from "../components/family-page";
import type { Installation } from "../state/installation";

const {
  Component: { KubeObjectAge, WithTooltip },
} = Renderer;

// A row of the list: the repository, how long ago it was last maintained by the clock of the views, and its storage
// location among the ones of the installation.
export interface RepositoryRow extends RepositoryView {
  ago?: string;
  storage?: Reference;
}

function repositoryRow(resource: BackupRepositoryResource, now: number, installation: Installation): RepositoryRow {
  const view = repositoryView(resource);

  return {
    ...view,
    ...(view.lastMaintenance === undefined ? {} : { ago: agoText(now - view.lastMaintenance) }),
    ...(view.location
      ? {
          storage: resolveReference(
            "BackupStorageLocation",
            view.location,
            view.namespace,
            installation.read("storageLocations"),
          ),
        }
      : {}),
  };
}

// What the cell of the last maintenance says: how long ago, or that there was none.
function maintainedText(row: RepositoryRow): string {
  return row.ago ?? REPOSITORY_WORDS.neverMaintained;
}

export const REPOSITORIES: ListDefinition<RepositoryRow> = {
  kind: "backup-repository",
  id: "backup-repositories",
  object: BackupRepository,
  tableId: "veleroBackupRepositoriesTable",
  // The storage location of a row is a way to its view when it is among the ones that were read.
  uses: ["storageLocations"],
  columns: [
    { title: "Name", id: "name", sortBy: "name", className: "name" },
    { title: "Installation", id: "namespace", sortBy: "namespace", className: "installation" },
    { title: "Volume namespace", id: "volume-namespace", sortBy: "volumeNamespace", className: "volume-namespace" },
    { title: "Storage location", id: "location", sortBy: "location", className: "location" },
    { title: "Type", id: "type", sortBy: "type", className: "repository-type" },
    { title: "Readiness", id: "readiness", sortBy: "readiness", className: "readiness" },
    { title: "Last maintenance", id: "maintained", sortBy: "maintained", className: "maintained" },
    { title: "Maintenance frequency", id: "frequency", sortBy: "frequency", className: "frequency" },
    { title: "Age", id: "age", sortBy: "age", className: "age" },
  ],
  view: (resource, now, installation) => repositoryRow(resource as BackupRepositoryResource, now, installation),
  sorting: REPOSITORY_SORTING,
  search: (row) => [...repositorySearch(row), maintainedText(row)],
  cells: (row, item) => [
    <WithTooltip key="namespace">{row.namespace}</WithTooltip>,
    <span key="volume-namespace" className={styles.cellWords}>
      <WithTooltip>{row.volumeNamespace ?? REPOSITORY_WORDS.notSet}</WithTooltip>
    </span>,
    <CellWay key="location" kind="storage-location" reference={row.storage} />,
    <span key="type" className={styles.cellWords}>
      <WithTooltip tooltip={writtenType(row.type) ? undefined : `${row.type}: ${NOT_WRITTEN.mark}`}>
        <WrittenValue text={row.type ?? REPOSITORY_WORDS.notSet} known={writtenType(row.type)} />
      </WithTooltip>
    </span>,
    <span key="readiness" className={styles.cellWords}>
      <WithTooltip tooltip={row.message?.value ?? row.readiness.label}>
        <RepositoryReadinessMark readiness={row.readiness} message={row.message?.value} titled={false} />
      </WithTooltip>
    </span>,
    // How long ago, which is read at a glance, with when it was in the tip, and the mark of a newest maintenance
    // that failed beside it: the time is the one of the last maintenance that succeeded.
    <span key="maintained" className={styles.cellWords} data-newest-failed={row.newestFailed}>
      <WithTooltip tooltip={row.lastMaintenance === undefined ? undefined : new Date(row.lastMaintenance)}>
        {maintainedText(row)}
      </WithTooltip>
      {row.newestFailed ? <FailedMaintenanceMark /> : null}
    </span>,
    <span key="frequency" className={styles.cellWords}>
      <WithTooltip>{repositoryFrequencyText(row.frequency)}</WithTooltip>
    </span>,
    <KubeObjectAge key="age" object={item} />,
  ],
};

// The Backup Repositories of the selected installation: the list and, over it, the view of what is open.
export function RepositoriesPage({ installation = currentInstallation() }: { installation?: Installation }) {
  return <FamilyPage definition={REPOSITORIES} installation={installation} view={OpenView} />;
}
