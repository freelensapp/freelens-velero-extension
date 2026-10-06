import { Renderer } from "@freelensapp/extensions";
import React from "react";
import {
  cutLine,
  foundPlaces,
  linePieces,
  lineRows,
  logLine,
  pieceParts,
  rowOf,
  textLines,
} from "../../common/artifact-log";
import { CONTENT } from "./artifact-viewer";
import styles from "./views.module.css";

import type { TextLines } from "../../common/artifact-log";

const {
  Component: { Icon, VirtualList },
} = Renderer;

// The height of a line of a list, in pixels. A row is as tall as the lines it takes, which are counted
// before it is drawn: the list of the host is given the height of every row, and measures none.
export const LINE = 20;
// The rows the list of the host keeps ready before and after the ones its room shows.
const READY = 10;
// The rows a list mounts at most, whatever the text and whatever the window.
export const ROWS_BOUND = 100;
// The tallest room a list is given: the one that shows, with the two rows its ends cut and the ones kept
// ready on both sides, as many rows as the bound.
export const ROOM = (ROWS_BOUND - 2 * READY - 2) * LINE;
// How far down the browser places what a page holds, in the pixels it lays out in: nothing past some
// thirty-three million of them. A pixel of the page is as many of those as the zoom of the page and the
// scale of the display make it, which is the ratio the window says: at twice the zoom, or on a display of
// twice the scale, a page places half as far, and a list that would be taller ends there.
const PLACED = 33_000_000;

// The ratio of the window: how many pixels of the layout a pixel of the page is. It changes with the zoom,
// which the window says as a change of its size, and with the display the window is on, which it says by
// the resolution alone. A ratio under one gives a list no room it would not have at one.
function useRatio(): number {
  const [ratio, setRatio] = React.useState(() => window.devicePixelRatio || 1);

  React.useEffect(() => {
    const read = () => setRatio(window.devicePixelRatio || 1);
    const display = typeof window.matchMedia === "function" ? window.matchMedia(`(resolution: ${ratio}dppx)`) : null;

    window.addEventListener("resize", read);
    display?.addEventListener?.("change", read);
    return () => {
      window.removeEventListener("resize", read);
      display?.removeEventListener?.("change", read);
    };
  }, [ratio]);
  return Math.max(1, ratio);
}
// The columns a wrapped line has at least, in a room narrower than them.
const COLUMNS_LEAST = 20;
// What the width of a character is measured on.
const PROBE = "0".repeat(100);

function many(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// How many lines a list shows, of how many the text has.
export function linesWords(rows: number, total: number): string {
  return rows === total ? many(total, "line") : `${rows} of ${many(total, "line")}`;
}

// The rows of a list: the height of each, by the lines it takes, and as many items as the list of the
// host counts its rows by, which carry nothing. The rows that would be placed further down than a page
// places anything, at the ratio of the window, are left out, and counted.
function layOut(lines: TextLines, shown: Uint32Array | undefined, columns: number | undefined, ratio: number) {
  const count = shown ? shown.length : lines.starts.length;
  const placed = Math.floor(PLACED / ratio);
  const heights: number[] = [];

  for (let row = 0, top = 0; row < count; row += 1) {
    const height = lineRows(lines, shown ? shown[row] : row, columns) * LINE;

    if (top + height > placed) break;
    heights.push(height);
    top += height;
  }
  return { heights, items: new Array<string>(heights.length).fill(""), left: count - heights.length };
}

interface LineRowProps {
  id: string;
  lines: TextLines;
  line: number;
  row: number;
  rows: number;
  columns: number | undefined;
  digits: number;
  // Whether the command of the row is the one of the list the Tab key reaches.
  reached: boolean;
  marked: boolean;
  // The words a search is of, which the row marks where it shows them.
  sought: string;
  list: React.RefObject<HTMLDivElement>;
  onCopy: (line: number) => void;
  // Where the list of the host places the row.
  style?: React.CSSProperties;
}

// One line in its row: its number, the command that copies it, and what the row shows of it, in the
// pieces the room takes it in. A line longer than the bound is cut, and says how much of it is left out.
// The words a search is of are marked where the row shows them, in every row that carries them: the row
// of the match the search is at is told from the others by its own mark, and so are its words.
function LineRow({
  id,
  lines,
  line,
  row,
  rows,
  columns,
  digits,
  reached,
  marked,
  sought,
  list,
  onCopy,
  style,
}: LineRowProps) {
  const element = React.useRef<HTMLDivElement>(null);
  const shown = cutLine(logLine(lines, line));
  const number = line + 1;
  // What a line that is cut says of itself: one line of the row, which a room of few columns cuts in its
  // turn, and which is whole for who points at it and for who does not see.
  const left = `${many(shown.left, "more character")} of this line ${
    shown.left === 1 ? "is" : "are"
  } not shown: the copy of the line takes it whole.`;
  const pieces: React.ReactNode[] = [];
  const places = sought ? foundPlaces(shown.text, sought) : [];
  let from = 0;

  for (const piece of linePieces(shown.text, columns)) {
    let at = from;

    pieces.push(
      <span key={from} className={styles.linesPiece}>
        {places.length
          ? pieceParts(piece, from, places).map((part) => {
              const key = at;

              at += part.text.length;
              return part.found ? (
                <mark key={key} className={styles.linesFound}>
                  {part.text}
                </mark>
              ) : (
                part.text
              );
            })
          : piece}
      </span>,
    );
    from += piece.length;
  }
  // A row that leaves the list while it has the focus gives it to the list: the keys go on moving among
  // the lines, and are not lost with the row.
  React.useLayoutEffect(
    () => () => {
      if (element.current?.contains(document.activeElement)) list.current?.focus({ preventScroll: true });
    },
    [list],
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: the list of the host places a row in elements of its own, which an item of a list element cannot be inside
    <div
      ref={element}
      role="listitem"
      aria-posinset={row + 1}
      aria-setsize={rows}
      aria-current={marked ? "true" : undefined}
      className={`${styles.linesRow}${marked ? ` ${styles.linesMarked}` : ""}`}
      data-testid={`${id}-line-${number}`}
      data-text-line={number}
      data-text-row={row}
      tabIndex={-1}
      style={style}
      {...(row === 0 ? { [CONTENT]: "" } : {})}
    >
      <span className={styles.linesNumber} style={{ minWidth: `${digits}ch` }}>
        {number}
      </span>
      <button
        type="button"
        className={styles.linesCopy}
        aria-label={`Copy line ${number}`}
        title={`Copy line ${number}`}
        tabIndex={reached ? 0 : -1}
        data-testid={`${id}-line-${number}-copy`}
        onClick={() => onCopy(line)}
      >
        <Icon material="content_copy" small />
      </button>
      <span className={styles.linesText} data-testid={`${id}-line-${number}-text`}>
        {pieces}
        {shown.left ? (
          <span
            className={`${styles.linesPiece} ${styles.linesCut}`}
            data-testid={`${id}-line-${number}-cut`}
            title={left}
            style={columns ? { maxWidth: `${columns}ch` } : undefined}
          >
            {left}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export interface LineListHandle {
  // Brings a line into the room of the list, and puts the list at it.
  show(line: number): void;
}

export interface LineListProps {
  id: string;
  // What the list is called, for who does not see it.
  name: string;
  lines: TextLines;
  // The lines a filter leaves, or nothing while no line is hidden.
  shown?: Uint32Array;
  wrap: boolean;
  // The line of the match a search is at.
  marked?: number;
  // The words a search is of, which are marked in the rows that show them.
  sought?: string;
  // What is said in the place of the list when it has no line.
  none: string;
}

// The lines of a text with their numbers, in the virtual list of the host: the rows its room shows are
// mounted, and the ones the host keeps ready around them. The text is the one it is given, and a line is
// made of it for a row that is mounted and for no other.
//
// The list is one stop of the Tab key, and the command of the line it is at another. The arrows, Page Up,
// Page Down, Home and End move it among its lines, with the focus on the row, which is read to who does
// not see; the Tab key goes from a row to the command that copies its line. A page is what the room
// shows, less a line, whatever its rows are tall.
export const LineList = React.forwardRef<LineListHandle, LineListProps>(function LineList(
  { id, name, lines, shown, wrap, marked, sought = "", none },
  ref,
) {
  // The columns of the room, measured while the lines are wrapped.
  const [columns, setColumns] = React.useState<number>();
  // The line the list is at.
  const [here, setHere] = React.useState(0);
  const [copied, setCopied] = React.useState("");
  const root = React.useRef<HTMLDivElement>(null);
  // The part the list of the host scrolls. The host draws it a moment after the list itself, once it has
  // measured its room: it is taken when it arrives. While the lines are wrapped its room is measured then,
  // and the list is drawn again for it; while they are not, nothing is drawn again for its arrival.
  const outer = React.useRef<HTMLDivElement | null>(null);
  const wrapped = React.useRef(wrap);
  const [scroller, setScroller] = React.useState<HTMLDivElement | null>(null);
  const scrolled = React.useCallback((part: HTMLDivElement | null) => {
    outer.current = part;
    if (!part) return;
    // The list is the stop of the Tab key, and the keys that move among the lines are its own: the part
    // that scrolls is no stop beside it, which it would be while none of its rows can be reached.
    part.tabIndex = -1;
    if (wrapped.current) setScroller(part);
  }, []);

  wrapped.current = wrap;
  const probe = React.useRef<HTMLSpanElement>(null);
  const list = React.useRef<Renderer.Component.VirtualListRef>(null);
  // Where the list is scrolled to, as the host last said, and the rows it was laid out in before.
  const offset = React.useRef(0);
  const before = React.useRef<{ lines: TextLines; heights: number[]; shown?: Uint32Array }>();
  // The row the keys went to before it was mounted, which is given the focus when the list has moved.
  const awaited = React.useRef<number>();
  const mounted = React.useRef(true);
  const ratio = useRatio();
  const layout = React.useMemo(
    () => layOut(lines, shown, wrap ? columns : undefined, ratio),
    [lines, shown, wrap, columns, ratio],
  );
  const rows = layout.heights.length;
  const listed = rows > 0;
  const digits = String(lines.starts.length).length;
  const at = Math.max(0, Math.min(rowOf(shown, here), rows - 1));

  const mountedRow = (row: number) => root.current?.querySelector<HTMLElement>(`[data-text-row="${row}"]`);
  // The list goes to a row: it is at its line, and the row is brought into its room. The keys take the
  // focus with them, to the row when it is mounted, and when the list has moved to it when it is not.
  const go = (row: number, focus: boolean) => {
    if (!rows) return;
    const to = Math.max(0, Math.min(row, rows - 1));
    const there = focus ? mountedRow(to) : undefined;

    setHere(shown ? shown[to] : to);
    there?.focus({ preventScroll: true });
    awaited.current = focus && !there ? to : undefined;
    list.current?.scrollToItem(to, "smart");
  };

  React.useImperativeHandle(ref, () => ({ show: (line) => go(rowOf(shown, line), false) }));
  React.useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  // The columns of the room: what is left of its width after the number and the command of a row, in
  // characters of the width they have here. They are measured on a row that is not shown, when the part
  // the host scrolls is there, and again when the room changes.
  React.useLayoutEffect(() => {
    if (!wrap || !listed) return;
    const measure = () => {
      const room = outer.current?.clientWidth ?? 0;
      const width = (probe.current?.getBoundingClientRect().width ?? 0) / PROBE.length;

      if (!probe.current || !room || !width) return;
      // One column less than the room has: no piece is wider than its row by a part of a character.
      setColumns(Math.max(COLUMNS_LEAST, Math.floor((room - probe.current.offsetLeft) / width) - 1));
    };

    measure();
    if (typeof ResizeObserver !== "function" || !outer.current) return;
    const observer = new ResizeObserver(measure);

    observer.observe(outer.current);
    return () => observer.disconnect();
  }, [wrap, listed, digits, scroller]);
  // The place of the scroll is kept when the rows change their heights or their number, which a choice to
  // wrap, a room that changes and a filter do: the line that was first in the room is first again, or the
  // next one that is left. Another text begins at its first line, which is the one that is given the focus.
  React.useLayoutEffect(() => {
    const was = before.current;

    before.current = { lines, heights: layout.heights, shown };
    if (!was?.heights.length || !layout.heights.length) return;
    if (was.lines !== lines) {
      setHere(0);
      list.current?.resetAfterIndex(0);
      list.current?.scrollToItem(0, "start");
      return;
    }
    if (!offset.current) return;
    let row = 0;

    for (let bottom = was.heights[0]; row < was.heights.length - 1 && bottom <= offset.current; ) {
      row += 1;
      bottom += was.heights[row];
    }
    const first = rowOf(shown, was.shown ? was.shown[row] : row);

    list.current?.resetAfterIndex(0);
    list.current?.scrollToItem(Math.max(0, Math.min(first, layout.heights.length - 1)), "start");
  }, [layout, shown, lines]);

  if (!listed) {
    return (
      <p
        className={`${styles.stateText} ${styles.linesNone}`}
        tabIndex={-1}
        data-testid={`${id}-none`}
        {...{ [CONTENT]: "" }}
      >
        {none}
      </p>
    );
  }
  // The line is copied whole, whatever its row shows of it, by the clipboard of the page, which the host
  // allows the frame of a cluster.
  const copy = async (line: number) => {
    const whole = logLine(lines, line);
    let said: string;

    try {
      await navigator.clipboard.writeText(whole);
      said = `Line ${line + 1} is copied whole: ${many(whole.length, "character")}.`;
    } catch {
      said = `Line ${line + 1} could not be copied: the clipboard did not take it.`;
    }
    if (mounted.current) setCopied(said);
  };
  // The row a page away from the one the list is at, after it or before it: the furthest one whose rows,
  // from the next to itself, the room shows together with a line to spare, and the next one at least. The
  // rows are as tall as the lines they take: a page of wrapped lines is fewer rows, and every row between
  // the two is in the room the list moves to.
  const paged = (by: 1 | -1): number => {
    const room = (outer.current?.clientHeight || 10 * LINE) - LINE;
    let to = at;

    for (let filled = 0, next = at + by; next >= 0 && next < rows; next += by) {
      if (to !== at && filled + layout.heights[next] > room) break;
      filled += layout.heights[next];
      to = next;
    }
    return to;
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // The first key of a list that was reached with the Tab key goes to the line the list is at.
    const inside = (event.target as HTMLElement).closest("[data-text-row]") !== null;
    const to =
      event.key === "ArrowDown"
        ? at + (inside ? 1 : 0)
        : event.key === "ArrowUp"
          ? at - (inside ? 1 : 0)
          : event.key === "PageDown"
            ? paged(1)
            : event.key === "PageUp"
              ? paged(-1)
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? rows - 1
                  : undefined;

    if (to === undefined) return;
    event.preventDefault();
    go(to, true);
  };
  // The list is at the line whose row, or whose command, has the focus.
  const onFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-text-line]");

    if (row) setHere(Number(row.dataset.textLine) - 1);
  };

  return (
    <>
      {layout.left ? (
        <p className={`${styles.notice} ${styles.noticeWarning}`} role="status" data-testid={`${id}-left`}>
          <Icon material="warning_amber" small aria-hidden />
          <span>
            The list has the room of {many(rows, "line")}: {many(layout.left, "line")} after them{" "}
            {layout.left === 1 ? "is" : "are"} not in it. The file that is saved has every line.
          </span>
        </p>
      ) : null}
      {/* biome-ignore lint/a11y/useSemanticElements: the list of the host is between this and its rows, with elements of its own */}
      <div
        ref={root}
        role="list"
        aria-label={name}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the list is what the Tab key reaches, and the keys that move among its lines are its own
        tabIndex={0}
        className={styles.linesList}
        data-testid={`${id}-text`}
        data-rows={rows}
        data-wrap={wrap ? "true" : "false"}
        data-columns={wrap ? columns : undefined}
        style={{ lineHeight: `${LINE}px`, maxHeight: ROOM }}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
      >
        <VirtualList<string>
          ref={list}
          className={styles.linesRows}
          items={layout.items}
          rowHeights={layout.heights}
          readyOffset={READY}
          outerRef={scrolled}
          onScroll={({ scrollOffset }) => {
            const row = awaited.current;

            offset.current = scrollOffset;
            awaited.current = undefined;
            if (row !== undefined) mountedRow(row)?.focus({ preventScroll: true });
          }}
          getRow={(row) => {
            const line = shown ? shown[row] : row;

            return (
              <LineRow
                id={id}
                lines={lines}
                line={line}
                row={row}
                rows={rows}
                columns={wrap ? columns : undefined}
                digits={digits}
                reached={row === at}
                marked={line === marked}
                sought={sought}
                list={root}
                onCopy={(copied) => void copy(copied)}
              />
            );
          }}
        />
        {wrap ? (
          <div className={styles.linesProbe} aria-hidden="true">
            <div className={styles.linesRow}>
              <span className={styles.linesNumber} style={{ minWidth: `${digits}ch` }} />
              <span className={styles.linesCopy} />
              <span className={styles.linesText}>
                <span ref={probe} className={styles.linesPiece}>
                  {PROBE}
                </span>
              </span>
            </div>
          </div>
        ) : null}
      </div>
      <p className={styles.factNote} role="status" data-testid={`${id}-copied`}>
        {copied}
      </p>
    </>
  );
});

// The choice to wrap the lines of a list, which says whether it is made, as a checkbox does: a command
// the Tab key reaches, which the checkbox of the host is not.
export function WrapChoice({ id, wrap, onChange }: { id: string; wrap: boolean; onChange: (wrap: boolean) => void }) {
  return (
    <button
      type="button"
      className={styles.linesChoice}
      aria-pressed={wrap}
      data-testid={`${id}-wrap`}
      onClick={() => onChange(!wrap)}
    >
      Wrap the lines
    </button>
  );
}

// A text shown as the lines it is, with a note over it: what a viewer shows of an artifact whose shape is
// not the one it was written for. The text is not read as a log: its lines have no level, and it has no
// search.
export function ArtifactLines({ id, text, note }: { id: string; text: string; note?: string }) {
  const lines = React.useMemo(() => textLines(text), [text]);
  const [wrap, setWrap] = React.useState(false);

  return (
    <div className={styles.lines} data-testid={id}>
      {note ? (
        <p className={styles.stateText} data-testid={`${id}-note`}>
          {note}
        </p>
      ) : null}
      <div className={styles.linesBar}>
        <WrapChoice id={id} wrap={wrap} onChange={setWrap} />
        <span className={styles.muted} data-testid={`${id}-count`}>
          {linesWords(lines.starts.length, lines.starts.length)}
        </span>
      </div>
      <LineList id={id} name="The lines of the text" lines={lines} wrap={wrap} none="The file has no line." />
    </div>
  );
}
