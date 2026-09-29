import { Renderer } from "@freelensapp/extensions";
import React from "react";
import { MARK_LISTED, markCount, markWords, operationLine } from "../../common/operation-line";
import { durationText, phaseText, signalText } from "../../common/operation-text";
import { operationTimeText } from "../../common/operation-time";
import { phaseIcon, time } from "./status";
import styles from "./views.module.css";

import type { LineMark } from "../../common/operation-line";
import type { Operation, Part } from "../../common/overview";

const {
  Component: { Icon },
} = Renderer;

// How an operation is named among the ones of both kinds: a backup and a restore may have the same name.
export function operationKey(operation: Operation): string {
  return `${operation.kind}/${operation.view.name}`;
}

// What a mark says to who points at it, or reaches it with the keyboard: what is drawn is said in words.
export function lineMarkText(mark: LineMark<Operation>, noun: string): string {
  const say = ({ view, time: when }: Operation) =>
    [
      view.name,
      phaseText(view.state),
      signalText(view.evidence),
      when.of === "none" ? "" : `${operationTimeText(when, view.state.execution)} ${time(when.time)}`,
      view.duration.state === "unavailable" ? "" : durationText(view.duration),
    ]
      .filter(Boolean)
      .join(", ");

  return markWords(mark, noun, say);
}

export interface LineRow {
  id: "backups" | "restores";
  title: string;
  noun: string;
  operations: Part<Operation>;
}

export interface OperationLinesProps {
  rows: LineRow[];
  // Where the line begins: the beginning of the window.
  from: number;
  now: number;
  // In words, what the line goes back to: the window.
  window: string;
  // The operations of a mark that holds more than one, to show them alone in the list under the line.
  shown?: string[];
  onOpen: (operation: Operation) => void;
  onShow: (keys: string[] | undefined) => void;
}

// The operations of a window on a line of time, a row for each kind, from the beginning of the window to
// now. A mark is an operation, or the operations that would be drawn over each other. Nothing is drawn
// where no operation is: what is between two operations has no name.
export function OperationLines({ rows, from, now, window, shown, onOpen, onShow }: OperationLinesProps) {
  const [line, setLine] = React.useState<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(800);

  // The line is measured where it is drawn, when it is drawn.
  React.useEffect(() => {
    if (!line) return;
    const measure = () => {
      const measured = line.getBoundingClientRect().width;

      if (measured > 0) setWidth(measured);
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);

    observer.observe(line);
    return () => observer.disconnect();
  }, [line]);
  const listed = (row: LineRow) => (row.operations.state === "listed" ? row.operations.items : []);
  // The rows are of one line: they end at the same time, which is the newest operation of any of them
  // when the clock of the cluster is ahead of the one of this machine.
  const to = rows
    .flatMap(listed)
    .reduce(
      (latest, operation) => (operation.time.of === "none" ? latest : Math.max(latest, operation.time.time)),
      now,
    );
  const chosen = shown ? new Set(shown) : undefined;

  // The line that is measured is the first one that is drawn: a row that was not read has none.
  const measured = rows.findIndex((row) => row.operations.state === "listed");

  return (
    <div className={styles.strip} data-testid="velero-overview-lines">
      {rows.map((row, index) => {
        const drawn = operationLine(listed(row), now, width, { from, to });

        return (
          <div key={row.id} className={styles.lineRow} data-line-row={row.id} data-line={row.operations.state}>
            <div className={styles.lineTitle}>{row.title}</div>
            {row.operations.state === "listed" ? (
              <div className={styles.stripLine} ref={index === measured ? setLine : undefined}>
                {(drawn?.marks ?? []).map((mark) => {
                  const keys = mark.items.map(operationKey);
                  const single = mark.items.length === 1 ? mark.items[0] : undefined;
                  const text = lineMarkText(mark, row.noun);
                  const active = chosen !== undefined && keys.every((key) => chosen.has(key));

                  return (
                    <button
                      key={keys[0]}
                      type="button"
                      className={`${styles.stripMark} ${mark.failing ? styles.stripFailing : ""} ${
                        single ? "" : styles.stripGroup
                      } ${active ? styles.stripActive : ""}`}
                      style={{ left: `${mark.at * 100}%` }}
                      title={text}
                      aria-label={text}
                      aria-pressed={single ? undefined : active}
                      data-line-mark={mark.items
                        .slice(0, MARK_LISTED)
                        .map((item) => item.view.name)
                        .join(",")}
                      data-line-held={mark.items.length}
                      data-failing={mark.failing}
                      data-not-started={mark.notStarted}
                      onClick={() => (single ? onOpen(single) : onShow(active ? undefined : keys))}
                    >
                      {single ? (
                        <Icon material={mark.notStarted ? "block" : phaseIcon(single.view.state)} small aria-hidden />
                      ) : (
                        <span className={styles.stripCount} data-characters={markCount(mark.items.length).length}>
                          {markCount(mark.items.length)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className={styles.muted} data-testid={`velero-overview-line-${row.id}-unread`}>
                {row.operations.reason}. The {row.noun}s of the last {window} are not known, which is not that there are
                none.
              </p>
            )}
            {row.operations.state === "listed" && !listed(row).length ? (
              <p className={styles.factNote} data-testid={`velero-overview-line-${row.id}-none`}>
                No {row.noun} of the last {window} is among the ones that exist.
              </p>
            ) : null}
            {row.operations.state === "listed" && row.operations.stale ? (
              <p className={styles.factNote} data-testid={`velero-overview-line-${row.id}-stale`}>
                The {row.noun}s could not be read again: these were read at {time(row.operations.at ?? 0)}.
              </p>
            ) : null}
          </div>
        );
      })}
      <div className={styles.stripEnds}>
        <span data-testid="velero-overview-line-from">{time(from)}</span>
        {/* An operation with a time after the clock of this machine is at the end of the line, with its time. */}
        <span data-testid="velero-overview-line-to">{to > now ? time(to) : "Now"}</span>
      </div>
    </div>
  );
}
