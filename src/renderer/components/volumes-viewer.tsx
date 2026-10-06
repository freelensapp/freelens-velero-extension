import { Renderer } from "@freelensapp/extensions";
import React from "react";
import {
  bytesText,
  claimNamespace,
  detailsOf,
  EMPTY,
  markText,
  NO_DETAILS,
  NO_FIELDS,
  NOT_STATED,
  notWritten,
  OTHER_FIELDS,
  otherShape,
  parseVolumes,
  sizeText,
  skippedReason,
  volumesCount,
} from "../../common/artifact-volumes";
import { timestamp } from "../../common/duration";
import { ArtifactLines } from "./artifact-lines";
import { CONTENT } from "./artifact-viewer";
import { time } from "./status";
import styles from "./views.module.css";

import type { ReactNode } from "react";

import type { Stated, VolumeField, VolumeRow } from "../../common/artifact-volumes";
import type { OperationKind } from "../../common/phases";
import type { ArtifactViewerProps } from "./artifact-viewer";

const {
  Component: { Icon, Table, TableCell, TableHead, TableRow },
} = Renderer;

// The host types the parts of its table with the events of an element and no more, and gives them no
// role: the roles of a table are given beside what they are passed.
const ROW = { role: "row" } as object;
const HEAD = { role: "columnheader" } as object;
const CELL = { role: "cell" } as object;

const RESULT_ICONS: Record<string, string> = { succeeded: "check", failed: "error_outline" };
const RESULT_STYLES: Record<string, string> = { succeeded: styles.signalNone, failed: styles.signalFailure };

// What an entry does not say, in the words of a cell and with the look of what is not there.
function NotStated() {
  return <span className={styles.muted}>{NOT_STATED}</span>;
}

// A method or a result as it is written. One the release does not write keeps its text, with the mark
// of what is not known in words beside an icon: a color alone would not say it.
function Written({ stated, what }: { stated?: Stated; what: "method" | "result" }) {
  if (!stated) return <NotStated />;
  if (!stated.known) {
    return (
      <span className={styles.volumeLines} data-known={false}>
        <span data-text>{stated.text}</span>
        <span className={styles.volumeMark} data-mark>
          <Icon material="help_outline" small aria-hidden />
          <span>{notWritten(what)}</span>
        </span>
      </span>
    );
  }
  if (what === "method") return <span data-known>{stated.text}</span>;
  // How a volume ended is read by its word, and seen by its mark.
  return (
    <span className={`${styles.status} ${RESULT_STYLES[stated.text]}`} data-known data-result={stated.text}>
      <Icon material={RESULT_ICONS[stated.text]} small aria-hidden />
      <span className={styles.statusText}>{stated.text}</span>
    </span>
  );
}

// A time as the other views show one, with the text of the entry for who points at it; a text that is
// not a time as it is written.
function When({ text }: { text?: string }) {
  const at = timestamp(text);

  if (text === undefined) return <NotStated />;
  return at === undefined ? <span>{text}</span> : <span title={text}>{time(at)}</span>;
}

function Mark({ mark }: { mark?: boolean }) {
  return mark === undefined ? <NotStated /> : <span>{markText(mark)}</span>;
}

interface Column {
  id: string;
  title: string;
  style: string;
  cell(row: VolumeRow): ReactNode;
}

const CLAIM: Column = {
  id: "claim",
  title: "Claim",
  style: styles.volumeClaim,
  cell: (row) => {
    const namespace = claimNamespace(row);

    return (
      <span className={styles.volumeLines}>
        <span className={row.claim ? undefined : styles.muted} data-claim>
          {row.claim ?? NOT_STATED}
        </span>
        {namespace ? (
          <span className={styles.factNote} data-namespace>
            {namespace}
          </span>
        ) : null}
      </span>
    );
  },
};
const VOLUME: Column = {
  id: "volume",
  title: "Volume",
  style: styles.volumeName,
  cell: (row) => (row.volume ? <span>{row.volume}</span> : <NotStated />),
};
const METHOD: Column = {
  id: "method",
  title: "Method",
  style: styles.volumeMethod,
  cell: (row) => <Written stated={row.method} what="method" />,
};
const RESULT: Column = {
  id: "result",
  title: "Result",
  style: styles.volumeResult,
  cell: (row) => <Written stated={row.result} what="result" />,
};
const MOVED: Column = {
  id: "moved",
  title: "Data moved",
  style: styles.volumeMoved,
  cell: (row) => <Mark mark={row.moved} />,
};
const KEPT: Column = {
  id: "kept",
  title: "Local snapshot kept",
  style: styles.volumeKept,
  cell: (row) => <Mark mark={row.kept} />,
};
const SKIPPED: Column = {
  id: "skipped",
  title: "Skipped",
  style: styles.volumeSkipped,
  cell: (row) => {
    const reason = skippedReason(row);

    return (
      <span className={styles.volumeLines}>
        <span className={row.skipped === undefined ? styles.muted : undefined} data-skipped>
          {markText(row.skipped)}
        </span>
        {reason ? (
          <span className={styles.factNote} data-reason>
            {reason}
          </span>
        ) : null}
      </span>
    );
  },
};
const STARTED: Column = {
  id: "started",
  title: "Started",
  style: styles.volumeStarted,
  cell: (row) => <When text={row.start} />,
};
const ENDED: Column = {
  id: "ended",
  title: "Ended",
  style: styles.volumeEnded,
  cell: (row) => <When text={row.end} />,
};
const SIZE: Column = {
  id: "size",
  title: "Size",
  style: styles.volumeSize,
  cell: (row) =>
    row.size === undefined ? <NotStated /> : <span title={bytesText(row.size)}>{sizeText(row.size)}</span>,
};

// What a row says of a volume, by the kind of the operation: a restore says how the volume was restored
// and whether its data was moved, and nothing of how it ended, of a skip or of a time.
const COLUMNS: Record<OperationKind, Column[]> = {
  Backup: [CLAIM, VOLUME, METHOD, RESULT, MOVED, KEPT, SKIPPED, STARTED, ENDED, SIZE],
  Restore: [CLAIM, VOLUME, METHOD, MOVED, SIZE],
};

// The fields of a detail of an entry, each by the name it is written with.
function Fields({ name, title, fields }: { name: string; title: string; fields: VolumeField[] }) {
  return (
    <section className={styles.volumeDetail} data-detail={name}>
      <h4 className={styles.volumeDetailTitle}>{title}</h4>
      {fields.length ? (
        <dl className={styles.volumeFields}>
          {fields.map((field) => (
            <div key={field.name} data-field={field.name}>
              <dt className={styles.volumeFieldName}>{field.name}</dt>
              <dd>{field.value === "" ? <span className={styles.muted}>{EMPTY}</span> : field.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className={styles.factNote}>{NO_FIELDS}</p>
      )}
    </section>
  );
}

// The volume information of an operation: how many volumes Velero recorded, then one row for each in a
// table of the host, with a command that opens the details of the row under it. The details are a row of
// the table and not a drawer, which the host closes on a click outside it. The text is parsed once; one
// that is not of the shape the release writes is shown as the lines it is.
export function VolumesViewer({ id, text, of }: ArtifactViewerProps) {
  const rows = React.useMemo(() => parseVolumes(text, of), [text, of]);
  // The rows that are open are rows of the text they were opened in: another text has none open.
  const [opened, setOpened] = React.useState<{ of: unknown; rows: ReadonlySet<number> }>({ of: rows, rows: new Set() });
  const open = opened.of === rows ? opened.rows : new Set<number>();
  const content = { [CONTENT]: "" };

  if (!rows) return <ArtifactLines id={id} text={text} note={otherShape(of)} />;
  if (!rows.length) {
    return (
      <div className={styles.volumes} data-testid={id} data-count={0}>
        <p className={styles.volumesCount} data-testid={`${id}-none`} tabIndex={-1} {...content}>
          {volumesCount(0, of)}
        </p>
      </div>
    );
  }
  const columns = COLUMNS[of];
  const toggle = (index: number) => {
    const next = new Set(open);

    if (!next.delete(index)) next.add(index);
    setOpened({ of: rows, rows: next });
  };
  // The table of the host draws the rows it is given and nothing else: the details of a row are a row,
  // and the rows are a list, never a fragment.
  const drawn: ReactNode[] = [];

  for (const [index, row] of rows.entries()) {
    const shown = open.has(index);
    const name = detailsOf(row, index);

    drawn.push(
      <TableRow key={`row-${index}`} data-volume-row={index} {...ROW}>
        <TableCell className={styles.volumeToggle} {...CELL}>
          <button
            type="button"
            className={styles.volumeOpen}
            data-testid={`${id}-toggle-${index}`}
            aria-label={name}
            aria-expanded={shown}
            aria-controls={shown ? `${id}-details-${index}` : undefined}
            title={name}
            onClick={() => toggle(index)}
          >
            <Icon material={shown ? "keyboard_arrow_down" : "keyboard_arrow_right"} small aria-hidden />
          </button>
        </TableCell>
        {columns.map((column) => (
          // The cell of the host shows a title in place of what it holds: what is read by who points
          // is on what the cell holds.
          <TableCell key={column.id} className={column.style} data-column={column.id} {...CELL}>
            {column.cell(row)}
          </TableCell>
        ))}
      </TableRow>,
    );
    if (!shown) continue;
    drawn.push(
      <TableRow key={`details-${index}`} data-volume-details={index} {...ROW}>
        <TableCell
          className={styles.volumeDetails}
          id={`${id}-details-${index}`}
          data-testid={`${id}-details-${index}`}
          aria-colspan={columns.length + 1}
          {...CELL}
        >
          {row.details.length || row.others.length ? null : <p className={styles.factNote}>{NO_DETAILS}</p>}
          {row.details.map((detail) => (
            <Fields key={detail.key} name={detail.key} title={detail.title} fields={detail.fields} />
          ))}
          {row.others.length ? <Fields name="others" title={OTHER_FIELDS} fields={row.others} /> : null}
        </TableCell>
      </TableRow>,
    );
  }

  return (
    <div className={styles.volumes} data-testid={id} data-count={rows.length}>
      <p className={styles.volumesCount} data-testid={`${id}-count`} tabIndex={-1} {...content}>
        {volumesCount(rows.length, of)}
      </p>
      {/* The room the table is scrolled in when its columns are wider than it, which is given the role
          the table of the host cannot be given. */}
      {/* biome-ignore lint/a11y/useSemanticElements: the table of the host is made of elements with no role */}
      <div
        className={styles.volumesTable}
        role="table"
        aria-label={`Volumes of the ${of.toLowerCase()}`}
        data-testid={`${id}-table`}
        data-of={of}
      >
        <Table scrollable={false} autoSize={false}>
          <TableHead {...ROW}>
            <TableCell className={styles.volumeToggle} {...HEAD}>
              <span className={styles.spoken}>Details</span>
            </TableCell>
            {columns.map((column) => (
              <TableCell key={column.id} className={column.style} {...HEAD}>
                {column.title}
              </TableCell>
            ))}
          </TableHead>
          {drawn}
        </Table>
      </div>
    </div>
  );
}
