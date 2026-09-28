import { Renderer } from "@freelensapp/extensions";
import React from "react";
import { durationText, phaseText, signalText } from "../../common/operation-text";
import { operationTimeText } from "../../common/operation-time";
import { historyStrip } from "../../common/schedule-history";
import { phaseIcon, time } from "./status";
import styles from "./views.module.css";

import type { HistoryItem, StripMark } from "../../common/schedule-history";

const {
  Component: { Icon },
} = Renderer;

// What a mark says to who points at it, or reaches it with the keyboard: what is drawn is said in words.
export function markText(mark: StripMark): string {
  const say = ({ view, time: when }: HistoryItem) =>
    [
      view.name,
      phaseText(view.state),
      signalText(view.evidence),
      when.of === "none" ? "" : `${operationTimeText(when, view.state.execution)} ${time(when.time)}`,
      view.duration.state === "unavailable" ? "" : durationText(view.duration),
    ]
      .filter(Boolean)
      .join(", ");

  if (mark.items.length === 1) return say(mark.items[0]);
  return [
    `${mark.items.length} backups close to each other`,
    mark.failing ? "one of them at least with a failure" : "",
    ...mark.items.map(say),
  ]
    .filter(Boolean)
    .join(". ");
}

export interface HistoryStripProps {
  items: HistoryItem[];
  now: number;
  // The backups of a mark that holds more than one, to show them alone in the list under the line.
  shown?: string[];
  onOpen: (name: string) => void;
  onShow: (names: string[] | undefined) => void;
}

// The backups of a history on a line of time, from the oldest that exists to now. A mark is a backup, or the
// backups that would be drawn over each other. Nothing is drawn where no backup is: what is between two
// backups has no name.
export function HistoryStrip({ items, now, shown, onOpen, onShow }: HistoryStripProps) {
  const [line, setLine] = React.useState<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(800);

  // The line is measured when it is drawn, which may be after the first time the history is: a history
  // that had nothing to draw has no line yet.
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
  const strip = historyStrip(items, now, width);

  if (!strip) return null;
  return (
    <div className={styles.strip} data-testid="velero-history-strip">
      <div className={styles.stripLine} ref={setLine}>
        {strip.marks.map((mark) => {
          const names = mark.items.map((item) => item.view.name);
          const single = mark.items.length === 1 ? mark.items[0] : undefined;
          const text = markText(mark);
          const active = shown !== undefined && names.every((name) => shown.includes(name));

          return (
            <button
              key={names.join("/")}
              type="button"
              className={`${styles.stripMark} ${mark.failing ? styles.stripFailing : ""} ${
                single ? "" : styles.stripGroup
              } ${active ? styles.stripActive : ""}`}
              style={{ left: `${mark.at * 100}%` }}
              title={text}
              aria-label={text}
              aria-pressed={single ? undefined : active}
              data-strip-mark={names.join(",")}
              data-failing={mark.failing}
              data-not-started={mark.notStarted}
              onClick={() => (single ? onOpen(single.view.name) : onShow(active ? undefined : names))}
            >
              {single ? (
                <Icon material={mark.notStarted ? "block" : phaseIcon(single.view.state)} small aria-hidden />
              ) : (
                <span className={styles.stripCount}>{mark.items.length}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className={styles.stripEnds}>
        <span data-testid="velero-history-from">{time(strip.from)}</span>
        {/* A backup with a time after the clock of this machine is at the end of the line, with its time. */}
        <span data-testid="velero-history-to">{strip.to > now ? time(strip.to) : "Now"}</span>
      </div>
      {strip.undrawn.length ? (
        <p className={styles.factNote} data-testid="velero-history-undrawn">
          {strip.undrawn.length === 1 ? "One backup has" : `${strip.undrawn.length} backups have`} no time that places
          it on the line: it is in the list.
        </p>
      ) : null}
    </div>
  );
}
