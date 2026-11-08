import { Renderer } from "@freelensapp/extensions";
import { dataMovement } from "../../common/volume-phases";
import { VOLUME_SORTING, volumeSearch, volumeView } from "../../common/volume-view";
import {
  bytesText,
  bytesTip,
  LIST_NOTES,
  NOT_REPORTED,
  NOT_WRITTEN,
  spanText,
  VOLUME_WORDS,
} from "../../common/volume-words";
import { time } from "../components/status";
import styles from "../components/views.module.css";
import { CellWay, NodeCell, VolumePhaseCell, WrittenValue } from "../components/volume-status";

import type { Renderer as RendererType } from "@freelensapp/extensions";

import type { VolumeKind } from "../../common/volume-phases";
import type { VolumeOperation } from "../../common/volume-references";
import type { VolumeView } from "../../common/volume-view";
import type { ListDefinition } from "../components/family-page";
import type { VeleroKind } from "../state/list-store";

const {
  Component: { KubeObjectAge, WithTooltip },
} = Renderer;

const OF: Record<
  VolumeKind,
  {
    kind: "pod-volume-backup" | "pod-volume-restore" | "data-upload" | "data-download";
    id: string;
    owner: "backup" | "restore";
    tableId: string;
  }
> = {
  PodVolumeBackup: {
    kind: "pod-volume-backup",
    id: "pod-volume-backups",
    owner: "backup",
    tableId: "veleroPodVolumeBackupsTable",
  },
  PodVolumeRestore: {
    kind: "pod-volume-restore",
    id: "pod-volume-restores",
    owner: "restore",
    tableId: "veleroPodVolumeRestoresTable",
  },
  DataUpload: { kind: "data-upload", id: "data-uploads", owner: "backup", tableId: "veleroDataUploadsTable" },
  DataDownload: { kind: "data-download", id: "data-downloads", owner: "restore", tableId: "veleroDataDownloadsTable" },
};

// The list of the operations of one kind: the same columns for each, in the order of the spec, with the cells they
// share. The secondary columns give their room in a narrow list in the order of the design. The column of the
// uploader of a pod volume operation is the one of the data mover of a data movement.
export function volumeOperationList(
  volume: VolumeKind,
  object: VeleroKind<RendererType.K8sApi.KubeObject>,
): ListDefinition<VolumeView> {
  const { kind, id, owner, tableId } = OF[volume];

  return {
    kind,
    id,
    object,
    tableId,
    // The backup or the restore of a row is a way to its view when it is among the ones that were read.
    uses: [owner === "backup" ? "backups" : "restores"],
    columns: [
      { title: "Name", id: "name", sortBy: "name", className: "name" },
      { title: "Installation", id: "namespace", sortBy: "namespace", className: "installation" },
      { title: "Phase", id: "phase", sortBy: "phase", className: "phase" },
      {
        title: owner === "backup" ? "Backup" : "Restore",
        id: "operation",
        sortBy: "operation",
        className: "operation",
      },
      { title: "Source", id: "volume", sortBy: "volume", className: "volume" },
      { title: "Node", id: "node", sortBy: "node", className: "node" },
      { title: "Progress", id: "bytes", sortBy: "bytes", className: "progress" },
      { title: "Started", id: "started", sortBy: "started", className: "started" },
      { title: "Duration", id: "duration", sortBy: "duration", className: "duration" },
      { title: "Storage location", id: "storage", sortBy: "storage", className: "storage" },
      {
        title: dataMovement(volume) ? "Data mover" : "Uploader",
        id: "uploader",
        sortBy: "uploader",
        className: "uploader",
      },
      { title: "Age", id: "age", sortBy: "age", className: "age" },
    ],
    view: (resource, now, installation) =>
      volumeView(volume, resource as VolumeOperation, now, {
        backups: installation.read("backups"),
        restores: installation.read("restores"),
      }),
    sorting: VOLUME_SORTING,
    search: volumeSearch,
    notes: () => [LIST_NOTES[volume]],
    cells: (row, item) => [
      <WithTooltip key="namespace">{row.namespace}</WithTooltip>,
      <VolumePhaseCell key="phase" state={row.state} message={row.message} />,
      <CellWay key="operation" kind={owner} reference={row.owner.reference} />,
      <span key="volume" className={styles.cellWords}>
        <WithTooltip>{row.source}</WithTooltip>
      </span>,
      <NodeCell key="node" name={row.node} />,
      <span key="bytes" className={styles.cellWords}>
        <WithTooltip tooltip={bytesTip(row.progress)}>{bytesText(row.progress)}</WithTooltip>
      </span>,
      // The time of the operator in the cell, and the one of the host, with its zone, over it.
      <WithTooltip key="started" tooltip={row.times.started === undefined ? undefined : new Date(row.times.started)}>
        {row.times.started === undefined ? VOLUME_WORDS.notStarted : time(row.times.started)}
      </WithTooltip>,
      <span key="duration" className={styles.cellWords}>
        <WithTooltip>{spanText(row.times.span)}</WithTooltip>
      </span>,
      <WithTooltip key="storage">{row.location ?? NOT_REPORTED}</WithTooltip>,
      <span key="uploader" className={styles.cellWords}>
        <WithTooltip tooltip={row.mover.known ? undefined : `${row.mover.text}: ${NOT_WRITTEN.mark}`}>
          <WrittenValue text={row.mover.text} known={row.mover.known} />
        </WithTooltip>
      </span>,
      <KubeObjectAge key="age" object={item} />,
    ],
  };
}
