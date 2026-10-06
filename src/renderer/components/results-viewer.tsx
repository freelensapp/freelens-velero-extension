import { Renderer } from "@freelensapp/extensions";
import React from "react";
import {
  countDifferences,
  groupTitle,
  messageParts,
  moreCommand,
  otherShape,
  parseResults,
  placeTitle,
  RESULTS_STEP,
  resultPlaces,
  resultsSummary,
  shownAtFirst,
  shownOfAll,
  shownText,
} from "../../common/artifact-results";
import { ArtifactLines } from "./artifact-lines";
import { CONTENT } from "./artifact-viewer";
import styles from "./views.module.css";

import type { ResultKind, ResultMessage, ResultPlace } from "../../common/artifact-results";
import type { ArtifactViewerProps } from "./artifact-viewer";

const {
  Component: { Icon },
} = Renderer;

// The two groups in the order of the page, each with the mark beside its title, which says the same in words.
const GROUPS: { kind: ResultKind; icon: string; style: string }[] = [
  { kind: "errors", icon: "error_outline", style: styles.signalFailure },
  { kind: "warnings", icon: "warning_amber", style: styles.signalWarnings },
];

// One message. The one the hook of the server wrote is shown in its parts, each by its name, and under
// them as it is written; a message of another form, as the ones of a restore are, is the text it is.
function Message({ message }: { message: ResultMessage }) {
  const parts = messageParts(message);

  if (!parts) return <p className={styles.resultsText}>{message.text}</p>;
  return (
    <>
      <dl className={styles.resultsParts}>
        {parts.map((part) => (
          <React.Fragment key={part.key}>
            <dt>{part.name}</dt>
            {/* A part the entry had with nothing in it is said to be empty: it is not a part it did not have. */}
            <dd data-part={part.key}>
              {part.value === "" ? <span className={styles.resultsEmpty}>Empty</span> : part.value}
            </dd>
          </React.Fragment>
        ))}
      </dl>
      <p className={styles.resultsWritten}>
        <span>As written:</span>
        <span data-written="">{message.text}</span>
      </p>
    </>
  );
}

// One place of a group: its title with its count, the messages of it that are shown, as a list named by
// the title, and the command that shows the ones after them. A group is a part of the page; a place is
// not, so that results of many namespaces are not as many parts to move among.
function Place({
  id,
  title,
  place,
  shown,
  added,
  onMore,
}: {
  id: string;
  // The identifier of its title, which is not made of the name of a namespace: a name may be anything.
  title: string;
  place: ResultPlace;
  shown: number;
  // Where the messages that were just added begin, when they were added to this place.
  added?: number;
  onMore: () => void;
}) {
  const list = React.useRef<HTMLUListElement>(null);
  const more = moreCommand(place, shown);

  // The focus follows what was asked for: it goes to the first of the messages that were added, where
  // the reading goes on, and is not left on nothing when the command that added them is gone.
  React.useEffect(() => {
    if (added !== undefined) (list.current?.children[added] as HTMLElement | undefined)?.focus();
  }, [added]);

  return (
    // Where the place is, and how many messages it holds, as they are: its title says them in words.
    <div data-testid={id} data-place={place.where} data-namespace={place.namespace} data-count={place.messages.length}>
      <h4 className={styles.resultsPlace} id={title}>
        {placeTitle(place)}
      </h4>
      {shown > 0 ? (
        <ul ref={list} className={styles.resultsMessages} aria-labelledby={title}>
          {place.messages.slice(0, shown).map((message, index) => (
            // A message is told from another by where it is: the same one may be written twice.
            <li key={index} tabIndex={-1}>
              <Message message={message} />
            </li>
          ))}
        </ul>
      ) : null}
      {more ? (
        <p className={styles.resultsMore}>
          <span data-testid={`${id}-shown`}>{shownText(place, shown)}</span>
          <button type="button" className={styles.link} data-testid={`${id}-more`} onClick={onMore}>
            {more}
          </button>
        </p>
      ) : null}
    </div>
  );
}

// What was asked for after the first messages, and of which results: other results start from their
// first. The results are named by what they showed at first, which is made once for each text: what was
// asked keeps nothing of a text that is not shown any more.
interface Asked {
  first: number[];
  // How many messages of each place are shown.
  shown: number[];
  // The place the last ones were added to, and where they begin in it.
  added?: { place: number; at: number };
}

// The results of an operation: the errors, then the warnings, each by Velero, the cluster and the
// namespaces by name, as headed lists with the count of each. Results can hold thousands of messages: the
// first ones are drawn, in the order of the page, and the others where they are asked for, a step at a
// time, while every count is said from the start. A text that is not of the shape of the release is shown
// as the text it is.
export function ResultsViewer({ id, text, of, counters, phase }: ArtifactViewerProps) {
  // A text is read once, when it arrives, and not each time the results are drawn.
  const results = React.useMemo(() => parseResults(text), [text]);
  const places = React.useMemo(() => (results ? resultPlaces(results) : []), [results]);
  const first = React.useMemo(() => shownAtFirst(places), [places]);
  const [asked, setAsked] = React.useState<Asked>();

  if (!results) return <ArtifactLines id={id} text={text} note={otherShape(of)} />;
  const now: Asked = asked?.first === first ? asked : { first, shown: first };
  const differences = countDifferences(results, of, counters, phase);
  const cut = shownOfAll(
    now.shown.reduce((sum, count) => sum + count, 0),
    results,
  );
  const show = (place: number) => {
    const shown = [...now.shown];

    shown[place] = Math.min(places[place].messages.length, shown[place] + RESULTS_STEP);
    setAsked({ first, shown, added: { place, at: now.shown[place] } });
  };

  return (
    // How many errors and how many warnings the results hold, as they are: the summary says them in words.
    <div
      className={styles.results}
      data-testid={id}
      data-errors={results.errors.count}
      data-warnings={results.warnings.count}
    >
      <p className={styles.resultsSummary} data-testid={`${id}-summary`} tabIndex={-1} {...{ [CONTENT]: "" }}>
        {resultsSummary(results, of)}
      </p>
      {differences.length ? (
        <div className={styles.resultsDiffers} data-testid={`${id}-differs`}>
          <Icon className={styles.resultsMark} material="info_outline" small aria-hidden />
          <div>
            {differences.map((difference) => (
              <p key={difference}>{difference}</p>
            ))}
          </div>
        </div>
      ) : null}
      {cut ? (
        <p className={styles.factNote} data-testid={`${id}-shown`}>
          {cut}
        </p>
      ) : null}
      {results.count > 0
        ? GROUPS.map((group) => (
            <section
              key={group.kind}
              data-testid={`${id}-${group.kind}`}
              data-count={results[group.kind].count}
              aria-labelledby={`${id}-${group.kind}-title`}
            >
              <h3 className={`${styles.sectionTitle} ${styles.resultsGroup}`} id={`${id}-${group.kind}-title`}>
                {results[group.kind].count > 0 ? (
                  <Icon className={group.style} material={group.icon} small aria-hidden />
                ) : null}
                <span>{groupTitle(group.kind, results[group.kind].count)}</span>
              </h3>
              {places.map((place, index) =>
                place.kind === group.kind ? (
                  <Place
                    key={`${place.where}/${place.namespace ?? ""}`}
                    id={`${id}-${place.kind}-${place.where}${place.namespace === undefined ? "" : `-${place.namespace}`}`}
                    title={`${id}-place-${index}-title`}
                    place={place}
                    shown={now.shown[index]}
                    added={now.added?.place === index ? now.added.at : undefined}
                    onMore={() => show(index)}
                  />
                ) : null,
              )}
            </section>
          ))
        : null}
    </div>
  );
}
