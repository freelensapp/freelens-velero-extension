import { Renderer } from "@freelensapp/extensions";
import React from "react";
import { LOG_LEVELS, parseLog, rowOf, searchLog, shownLines } from "../../common/artifact-log";
import { LineList, linesWords, WrapChoice } from "./artifact-lines";
import { escapeOfField } from "./artifact-viewer";
import styles from "./views.module.css";

import type { LogLevel } from "../../common/artifact-log";
import type { LineListHandle } from "./artifact-lines";
import type { ArtifactViewerProps } from "./artifact-viewer";

const {
  Component: { Button, Icon, Input },
} = Renderer;

const LEVEL_TITLES: Record<LogLevel, string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
  debug: "Debug",
  other: "Other",
};
// No level chosen: no line is hidden.
const EVERY: ReadonlySet<LogLevel> = new Set();

// What the search says of itself: nothing while no word is typed, that no line carries the words, or the
// match it is at among the ones there are, and its line. One match is one line.
export function searchWords(words: string, count: number, at: number, line: number, filtered: boolean): string {
  if (!words) return "";
  if (!count) return `No line${filtered ? " of the levels that are chosen" : ""} carries these words.`;
  return `Match ${at + 1} of ${count}, on line ${line + 1}.`;
}

// The log of an operation: its lines with their numbers, a search among them and a filter by level. The
// text is the one copy the tab holds. It is read once into where its lines begin and the level of each;
// the lines a filter leaves and the ones a search finds are found when they are asked for and kept until
// what they were found by changes. Moving among the matches reads nothing again.
export function LogViewer({ id, text }: ArtifactViewerProps) {
  const log = React.useMemo(() => parseLog(text), [text]);
  const [levels, setLevels] = React.useState(EVERY);
  const [words, setWords] = React.useState("");
  const [wrap, setWrap] = React.useState(false);
  // The line of the match the operator moved to.
  const [asked, setAsked] = React.useState(-1);
  const list = React.useRef<LineListHandle>(null);
  const shown = React.useMemo(() => shownLines(log, levels), [log, levels]);
  const found = React.useMemo(() => searchLog(log, words, levels), [log, words, levels]);
  // The match the search is at: the one of the line it was at while that line is still found, and the
  // first otherwise.
  const place = rowOf(found, asked);
  const at = place >= 0 && found[place] === asked ? place : found.length ? 0 : -1;
  const line = at < 0 ? undefined : found[at];
  const rows = shown ? shown.length : log.starts.length;

  // The match the search is at is brought into the room of the list: when it changes, and when what is
  // found does.
  React.useEffect(() => {
    if (line !== undefined) list.current?.show(line);
  }, [line, found]);
  // The next match and the one before, around the ends. The match that is asked for is brought into the
  // room of the list even when it is the one the search was at already, which an only match is.
  const move = (by: number) => {
    if (!found.length) return;
    const to = found[(at + by + found.length) % found.length];

    setAsked(to);
    list.current?.show(to);
  };
  const toggle = (level: LogLevel) =>
    setLevels((chosen) => {
      const next = new Set(chosen);

      if (!next.delete(level)) next.add(level);
      return next;
    });

  return (
    <div className={styles.lines} data-testid={id}>
      <div className={styles.linesBar}>
        <div className={styles.linesSearch}>
          <span id={`${id}-search-label`} className={styles.targetLabel}>
            Search the log
          </span>
          <Input
            theme="round-black"
            className={styles.linesField}
            aria-labelledby={`${id}-search-label`}
            placeholder="Words of a line"
            data-testid={`${id}-search`}
            value={words}
            // Enter goes to the next match, and to the one after it: the field keeps the focus. Escape
            // clears the words, and is not the key that leaves the view while the focus is in the field.
            blurOnEnter={false}
            onChange={(next) => setWords(next)}
            onKeyDown={(event) => {
              if (escapeOfField(event, () => setWords("")) || event.key !== "Enter") return;
              event.preventDefault();
              move(event.shiftKey ? -1 : 1);
            }}
          />
          <Button
            plain
            aria-label="Previous match"
            tooltip="Previous match"
            disabled={!found.length}
            data-testid={`${id}-search-previous`}
            onClick={() => move(-1)}
          >
            <Icon material="keyboard_arrow_up" small />
          </Button>
          <Button
            plain
            aria-label="Next match"
            tooltip="Next match"
            disabled={!found.length}
            data-testid={`${id}-search-next`}
            onClick={() => move(1)}
          >
            <Icon material="keyboard_arrow_down" small />
          </Button>
          {/* What the search found, said to who does not see: the part is always there, and its words change.
              The words that were searched, how many lines carry them, the match the search is at, counted
              from zero, and its line are written together, as they are: one is never of another search. */}
          <span
            className={styles.muted}
            role="status"
            data-testid={`${id}-search-status`}
            data-words={words}
            data-matches={found.length}
            data-match={at}
            data-line={line === undefined ? undefined : line + 1}
          >
            {searchWords(words, found.length, at, line ?? 0, levels.size > 0)}
          </span>
        </div>
        {/* The levels are each shown alone or not, by itself: a choice says whether it is made as a
            checkbox does. What choosing one does is the name of the group, for who does not see, and two
            words before the first of them for who does. */}
        <fieldset className={styles.linesLevels} data-testid={`${id}-levels`}>
          <legend className={styles.spoken}>Show only the lines of these levels</legend>
          <span className={styles.targetLabel} aria-hidden="true">
            Show only
          </span>
          {LOG_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className={styles.linesChoice}
              aria-pressed={levels.has(level)}
              data-testid={`${id}-level-${level}`}
              data-count={log.counts[level]}
              onClick={() => toggle(level)}
            >
              {LEVEL_TITLES[level]} {log.counts[level]}
            </button>
          ))}
        </fieldset>
        <WrapChoice id={id} wrap={wrap} onChange={setWrap} />
        <span
          className={styles.muted}
          role="status"
          data-testid={`${id}-count`}
          data-shown={rows}
          data-lines={log.starts.length}
        >
          {linesWords(rows, log.starts.length)}
        </span>
      </div>
      <LineList
        ref={list}
        id={id}
        name="The lines of the log"
        lines={log}
        shown={shown}
        wrap={wrap}
        marked={line}
        sought={words}
        none={log.starts.length ? "No line is of the levels that are chosen." : "The log has no line."}
      />
    </div>
  );
}
