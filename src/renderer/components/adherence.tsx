import { Renderer } from "@freelensapp/extensions";
import { lastObservedRun, SIGNAL_WORDS, scheduleSignal } from "../../common/schedule-signal";
import styles from "./views.module.css";
import { ViewLink } from "./workspace";

import type { ReactNode } from "react";

import type { AdherenceContext, NextRun, ScheduleSignal, SignalMark, SignalState } from "../../common/schedule-signal";
import type { ScheduleResource } from "../../common/types";

const {
  Component: { Icon, LocaleDate, WithTooltip },
} = Renderer;

// The marks the views already use for what they mean here: a hollow one for what is awaited, the one of a
// validation that is late, the one of what is not known, the one of an expression Velero refused, and one for
// what is paused. The word of the state is always beside the mark: the mark says nothing a word does not.
const MARK_ICONS: Record<SignalMark, string> = {
  awaited: "radio_button_unchecked",
  late: "warning_amber",
  "not-known": "help_outline",
  refused: "highlight_off",
  paused: "pause_circle_outline",
};
const MARK_STYLES: Record<SignalMark, string> = {
  awaited: "",
  late: styles.signalWarnings,
  "not-known": styles.signalUnknown,
  refused: styles.signalFailure,
  paused: "",
};

// The mark of the state of a schedule and its word, which is there for who does not see the mark.
export function AdherenceMark({ signal }: { signal: ScheduleSignal }) {
  return (
    <span
      className={[styles.status, MARK_STYLES[signal.mark]].filter(Boolean).join(" ")}
      data-adherence={signal.state}
      data-mark={signal.mark}
      data-reason={signal.reason}
    >
      <Icon material={MARK_ICONS[signal.mark]} small aria-hidden />
      <span className={styles.statusText}>{signal.label}</span>
    </span>
  );
}

// What the tip of the mark says: the sentence of the state, and what is said beside it.
export function adherenceTip(signal: ScheduleSignal): string {
  return [signal.words, ...signal.notes].join(" ");
}

// The cell of the adherence in the list: the mark and its word, with the sentence and the notes in its tip.
export function AdherenceCell({ signal }: { signal: ScheduleSignal }) {
  return (
    <span className={styles.cellWords}>
      <WithTooltip tooltip={adherenceTip(signal)}>
        <AdherenceMark signal={signal} />
      </WithTooltip>
    </span>
  );
}

// The next run in a few words: how far it is from now, with its instant in the tip as the host writes a date,
// or None and Not known with why in the tip.
export function NextRunText({ next }: { next: NextRun }) {
  return (
    <span className={styles.cellWords} data-next={next.kind}>
      <WithTooltip tooltip={next.kind === "at" ? new Date(next.at) : next.why}>{next.text}</WithTooltip>
    </span>
  );
}

// The words of the band that are not of the signal.
export const BAND_WORDS = {
  title: "Adherence",
  hostTime: "In the time zone of the preferences:",
  loading: "The backups of this installation are being read: the adherence of the schedule is said once they are.",
};

// The lines of the band, in their order, with the names it shows them under.
const LINES = {
  next: "Next run",
  zone: "Zone",
  anchor: "Counted from",
  observed: "Last observed run",
  held: "Held by",
  passed: "Expected runs passed",
  clocks: "Clocks",
} as const;

type Line = keyof typeof LINES;

// The states the grace says something of: the ones whose run is expected, or held.
const GRACED: SignalState[] = ["awaited", "due", "overdue", "held"];

// A text without the sentences given, each said elsewhere.
function without(text: string, sentences: string[]): string {
  return sentences
    .reduce((said, sentence) => said.split(sentence).join(""), text)
    .replace(/\s{2,}/g, " ")
    .trim();
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A sentence with the names of the backups it says made the ways to their views. A name is one only where it is
// whole: not inside another name.
function withWays(sentence: string, backups: (string | undefined)[]): ReactNode {
  const names = [...new Set(backups.filter((name): name is string => Boolean(name)))].sort(
    (one, other) => other.length - one.length,
  );

  if (!names.length) return sentence;
  const found = new RegExp(`(?<![a-z0-9.-])(${names.map(escaped).join("|")})(?![a-z0-9-])`, "g");

  return sentence
    .split(found)
    .map((part, index) =>
      names.includes(part) ? <ViewLink key={`${part}-${index}`} target={{ kind: "backup", name: part }} /> : part,
    );
}

// The band of the adherence of a schedule (REQ-169): one line for each fact, a name and what it says, in the
// order an operator reads them, and only the lines that have something to say. The line of time of the history
// under it is not changed: nothing is drawn where no backup is.
export function AdherenceBand({ schedule, context }: { schedule: ScheduleResource; context?: AdherenceContext }) {
  if (!context) {
    return (
      <>
        <h3 className={styles.sectionTitle}>{BAND_WORDS.title}</h3>
        <p className={styles.stateText} data-testid="velero-schedule-adherence" data-adherence="loading">
          {BAND_WORDS.loading}
        </p>
      </>
    );
  }
  const signal = scheduleSignal(schedule, context);
  const observed = lastObservedRun(schedule, context);
  const hold = signal.hold;
  const held =
    hold?.state === "held"
      ? [SIGNAL_WORDS.heldNow(hold.backup, hold.phase), hold.others ? SIGNAL_WORDS.heldMore(hold.others) : ""]
          .filter(Boolean)
          .join(" ")
      : hold?.state === "not-known"
        ? SIGNAL_WORDS.holdNotKnown(hold.reason)
        : undefined;
  // What a line of its own says is not said again under the next run: the backup that holds, how many more do,
  // and why whether one holds is not known.
  const notes = signal.notes.filter((note) => note !== held);
  const words =
    hold?.state === "held"
      ? without(signal.words, [
          SIGNAL_WORDS.heldNow(hold.backup, hold.phase),
          ...(hold.others ? [SIGNAL_WORDS.heldMore(hold.others)] : []),
        ])
      : signal.words;
  const lines: [Line, ReactNode][] = [
    [
      "next",
      <>
        <div className={styles.adherenceState}>
          <AdherenceMark signal={signal} />
          <span data-words>{words}</span>
        </div>
        {signal.next.kind === "at" ? (
          <div className={styles.factNote}>
            {BAND_WORDS.hostTime}{" "}
            <span data-host-time>
              <LocaleDate date={new Date(signal.next.at)} />
            </span>
          </div>
        ) : null}
        {notes.map((note) => (
          <div key={note} className={styles.factNote} data-note>
            {note}
          </div>
        ))}
        {GRACED.includes(signal.state) ? (
          <div className={styles.factNote} data-grace>
            {SIGNAL_WORDS.grace}
          </div>
        ) : null}
      </>,
    ],
  ];

  if (signal.zone) lines.push(["zone", signal.zone.words]);
  if (signal.anchor) lines.push(["anchor", signal.anchor.words]);
  lines.push([
    "observed",
    observed.words.map((sentence) => (
      <div key={sentence}>
        {withWays(sentence, [
          observed.submission.state === "found" ? observed.submission.backup : undefined,
          observed.newer?.backup,
          observed.newest,
        ])}
      </div>
    )),
  ]);
  if (held !== undefined) lines.push(["held", withWays(held, [hold?.state === "held" ? hold.backup : undefined])]);
  if (signal.expected) lines.push(["passed", signal.expected.words]);
  lines.push(["clocks", context.clocks.words]);

  return (
    <>
      <h3 className={styles.sectionTitle}>{BAND_WORDS.title}</h3>
      <table
        className={`${styles.references} ${styles.adherence}`}
        data-testid="velero-schedule-adherence"
        data-adherence={signal.state}
      >
        <tbody>
          {lines.map(([line, content]) => (
            <tr key={line} data-line={line}>
              <th scope="row">{LINES[line]}</th>
              <td>{content}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
