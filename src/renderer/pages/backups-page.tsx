import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import {
  backupView,
  countsText,
  durationText,
  progressText,
  SORTING,
  searchFields,
  signalText,
} from "../../common/backup-view";
import { EntryState } from "../components/entry-state";
import { Phase, Signal, time } from "../components/status";
import { Styles } from "../components/styles";
import { Coverage, TargetBar } from "../components/target-bar";
import styles from "../components/views.module.css";
import { BACKUP_PARAM, pageParam } from "../navigation";
import { currentInstallation } from "../state/context";
import { BackupListStore } from "../state/list-store";
import { BackupWorkspace } from "./backup-workspace";

import type { BackupView } from "../../common/backup-view";
import type { BackupResource } from "../../common/types";
import type { Backup } from "../api/kinds";
import type { Installation } from "../state/installation";

const {
  Component: { Icon, KubeObjectAge, KubeObjectListLayout, TabLayout, WithTooltip },
} = Renderer;

type Column = keyof typeof SORTING;

const COLUMNS: { title: string; id: Column; sortBy: Column; className: string }[] = [
  { title: "Name", id: "name", sortBy: "name", className: "name" },
  { title: "Installation", id: "namespace", sortBy: "namespace", className: "installation" },
  { title: "Phase", id: "phase", sortBy: "phase", className: "phase" },
  { title: "Failure", id: "errors", sortBy: "errors", className: "failure" },
  { title: "Item progress", id: "progress", sortBy: "progress", className: "progress" },
  { title: "Started", id: "started", sortBy: "started", className: "started" },
  { title: "Duration", id: "duration", sortBy: "duration", className: "duration" },
  { title: "Storage", id: "storage", sortBy: "storage", className: "storage" },
  { title: "Age", id: "age", sortBy: "age", className: "age" },
];

// The clock of the views: one reading for every row, taken again while a view is open.
function useNow(interval = 5000): number {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);

    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

function openBackup(name: string): void {
  pageParam(BACKUP_PARAM).set(name);
}

const BackupList = observer(({ installation, now }: { installation: Installation; now: number }) => {
  const store = React.useMemo(() => new BackupListStore(installation), [installation]);
  const view = (item: Backup): BackupView => backupView(item as unknown as BackupResource, now);
  const sortingCallbacks = Object.fromEntries(
    Object.entries(SORTING).map(([column, order]) => [column, (item: Backup) => order(view(item))]),
  );
  const read = installation.read("backups");

  // A list that was never read has no rows to show and no count: what it is instead is said by the notice.
  if (
    read.lastSuccess === undefined &&
    read.status !== "ready" &&
    read.status !== "loading" &&
    read.status !== "idle"
  ) {
    return (
      <div className={styles.state} data-testid="velero-backups-unavailable">
        <div className={styles.stateTitle}>The backups of {installation.namespace} are not shown</div>
        <p className={styles.stateText}>
          {read.status === "forbidden"
            ? "Access to the backups of this namespace is denied. How many there are is not known."
            : read.status === "not-served"
              ? "This cluster does not serve the backups of Velero."
              : "The backups of this namespace could not be read. How many there are is not known."}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* A list with nothing in it says of what it is the list: the host says that it is empty. */}
      {read.status === "ready" && read.items.length === 0 ? (
        <div role="status" className={`${styles.notice} ${styles.noticeInfo}`} data-testid="velero-backups-empty">
          <Icon material="info_outline" small />
          <span>
            No backup is in the namespace {installation.namespace} of {installation.cluster.name}.
          </span>
        </div>
      ) : null}
      <KubeObjectListLayout
        tableId="veleroBackupsTable"
        className={styles.list}
        data-testid="velero-backups"
        store={store as never}
        getItems={() => store.items}
        subscribeStores={false}
        // The view only reads: no row is selected, no row has a menu, and nothing can be added or removed.
        isSelectable={false}
        renderItemMenu={() => null}
        customizeHeader={({ filters: _hostNamespaces, ...placeholders }) => ({ ...placeholders, filters: <></> })}
        onDetails={(item: Backup) => openBackup(item.getName())}
        sortingCallbacks={sortingCallbacks}
        searchFilters={[(item: Backup) => searchFields(view(item))]}
        renderHeaderTitle="Backups"
        renderTableHeader={COLUMNS}
        renderTableContents={(item: Backup) => {
          const row = view(item);

          return [
            // The name is what the keyboard reaches: the row of the host answers to the pointer alone.
            <button
              key="name"
              type="button"
              className={styles.rowLink}
              title={row.name}
              data-backup-row={row.name}
              onClick={(event) => {
                event.stopPropagation();
                openBackup(row.name);
              }}
            >
              {row.name}
            </button>,
            <WithTooltip key="namespace">{row.namespace}</WithTooltip>,
            <Phase key="phase" state={row.state} />,
            <Signal
              key="failure"
              evidence={row.evidence}
              title={`${signalText(row.evidence)}. Errors / warnings: ${countsText(row.evidence)}`}
            />,
            <WithTooltip key="progress">{progressText(row.progress)}</WithTooltip>,
            // The time of the operator in the cell, and the one of the host, with its zone, over it.
            <WithTooltip key="started" tooltip={row.started === undefined ? undefined : new Date(row.started)}>
              {time(row.started)}
            </WithTooltip>,
            <WithTooltip key="duration">{durationText(row.duration)}</WithTooltip>,
            <WithTooltip key="storage">{row.storage ?? "Not reported"}</WithTooltip>,
            <KubeObjectAge key="age" object={item} />,
          ];
        }}
      />
    </>
  );
});

// The Backups of the selected installation: the list and, over it, the workspace of the backup that is
// open. The list stays where it is while a backup is open, with its search, its order and its scroll.
export const BackupsPage = observer(({ installation = currentInstallation() }: { installation?: Installation }) => {
  const now = useNow();
  const open = pageParam(BACKUP_PARAM).get();
  const ready = installation.entry.state === "ready";
  const list = React.useRef<HTMLDivElement>(null);
  const opened = React.useRef<string>();

  React.useEffect(() => {
    void installation.open();
    return installation.watch();
  }, [installation]);

  // Who comes back from a backup is where they were: on the row they had opened.
  React.useEffect(() => {
    if (open) {
      opened.current = open;
      return;
    }
    const name = opened.current;
    let frame = 0;
    let tries = 0;
    // The list of the host may draw its rows again when it is shown: the focus is given to the row that
    // is there, and again if the row that had it was replaced.
    const focus = () => {
      const rows = [...(list.current?.querySelectorAll<HTMLElement>("[data-backup-row]") ?? [])];
      const row = rows.find((candidate) => candidate.dataset.backupRow === name);

      // The list is where it was scrolled: the focus does not move it.
      row?.focus({ preventScroll: true });
      tries += 1;
      if (tries < 20 && (document.activeElement !== row || tries < 3)) frame = requestAnimationFrame(focus);
    };

    opened.current = undefined;
    if (!name) return;
    focus();
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <TabLayout>
      <Styles />
      <div className={styles.page} data-testid="velero-backups-page">
        <TargetBar installation={installation} />
        <Coverage
          installation={installation}
          families={open ? ["backups", "restores", "schedules", "storageLocations", "snapshotLocations"] : ["backups"]}
        />
        {ready ? (
          <div className={styles.content}>
            <div
              ref={list}
              className={`${styles.content} ${open ? styles.behind : ""}`}
              aria-hidden={open ? true : undefined}
            >
              <BackupList installation={installation} now={now} />
            </div>
            {open ? (
              <div className={styles.over}>
                <BackupWorkspace
                  installation={installation}
                  name={open}
                  now={now}
                  onBack={() => pageParam(BACKUP_PARAM).clear()}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <EntryState installation={installation} />
        )}
      </div>
    </TabLayout>
  );
});
