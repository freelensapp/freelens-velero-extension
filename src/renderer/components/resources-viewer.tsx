import { Renderer } from "@freelensapp/extensions";
import React from "react";
import { List } from "react-window";
import {
  actionChoice,
  filterResources,
  itemsCount,
  NOT_STATED,
  otherShape,
  parseResources,
  RESTORE_ACTIONS,
  resourcesCount,
} from "../../common/artifact-resources";
import { ArtifactLines } from "./artifact-lines";
import { CONTENT, escapeOfField } from "./artifact-viewer";
import styles from "./views.module.css";

import type { RowComponentProps } from "react-window";

import type { ActionCount, ParsedResources, ResourceItem, ResourceKind } from "../../common/artifact-resources";
import type { ArtifactViewerProps } from "./artifact-viewer";

const {
  Component: { Input, TableCell, TableHead, TableRow },
} = Renderer;

// The height the host gives a row of its tables: a line of 17 pixels, with 8 over it and 8 under it.
const ROW = 33;
// The rows the list keeps ready on each side of the ones its room shows.
const READY = 10;
// The choices of the filter by action: every action, each one the release writes, and none of them.
const CHOICES: readonly (ActionCount | undefined)[] = [undefined, ...RESTORE_ACTIONS, NOT_STATED];

// The rows the table shows at least, where it has as many, and the ones it shows at most. Between the two
// the room of its rows is what the view leaves under what is over them: it is counted on the room the
// table is read in, by its layout, and never on the window, so that the table is whole in that room and
// is scrolled inside itself alone. The least is the height a list of lines has at least.
const LEAST = 6;
const MOST = 20;

// The rows of the table, one after the other: each resource, then its items. react-window asks for a row
// by its place among them: nothing is built for a row but its place.
function rowsOf(list: ParsedResources): (ResourceKind | ResourceItem)[] {
  const rows: (ResourceKind | ResourceItem)[] = [];

  for (const resource of list.resources) {
    rows.push(resource);
    for (const item of resource.items) rows.push(item);
  }
  return rows;
}

// A text on one line of its cell, cut where the cell ends, and whole for who points at it.
function Cut({ text }: { text: string }) {
  return (
    <span className={styles.resourcesText} title={text}>
      {text}
    </span>
  );
}

interface ResourceRowProps {
  id: string;
  rows: (ResourceKind | ResourceItem)[];
  // Whether the items have an action, as the ones of a restore have.
  actions: boolean;
  // Whether a filter is on: a resource then says of how many items, of the whole list, it shows its own.
  filtered: boolean;
  // How many items each resource has in the whole list.
  all: Map<string, number>;
}

// A row of the table, at its place among the rows: a resource with its count, or an item with its cells,
// in the rows of the tables of the host. react-window places it; it is a row of the table, and takes no
// role of an item of a list.
function ResourceRow({ index, style, id, rows, actions, filtered, all }: RowComponentProps<ResourceRowProps>) {
  const shown = rows[index];

  if (!shown) return null;
  if ("items" in shown) {
    return (
      <TableRow
        nowrap
        className={styles.resourcesKind}
        testId={`${id}-kind`}
        data-resource={shown.resource}
        data-count={shown.items.length}
        style={style}
      >
        <TableCell className="resource">
          <Cut text={shown.resource} />
        </TableCell>
        <TableCell className="count">
          {itemsCount(shown.items.length, filtered ? all.get(shown.resource) : undefined)}
        </TableCell>
      </TableRow>
    );
  }
  return (
    <TableRow nowrap testId={`${id}-item`} data-item={shown.text} style={style}>
      <TableCell className="namespace">
        {shown.namespace === undefined ? (
          <span className={styles.muted} data-scope="cluster" title="An item of the cluster: it is of no namespace">
            cluster
          </span>
        ) : (
          <Cut text={shown.namespace} />
        )}
      </TableCell>
      <TableCell className="name">
        <Cut text={shown.name} />
      </TableCell>
      {actions ? (
        <TableCell className="action">
          {shown.action ? (
            <span className={shown.action === "failed" ? styles.resourcesFailed : undefined} data-action={shown.action}>
              {shown.action}
            </span>
          ) : (
            <span className={styles.muted} data-action="">
              {NOT_STATED}
            </span>
          )}
        </TableCell>
      ) : null}
    </TableRow>
  );
}

// The resource list that was read: its count, its filter, and its rows windowed by react-window, under the
// head of the tables of the host. A list can be of tens of thousands of items: the rows that are mounted
// are the ones of the room, twenty at most, and the ten kept ready on each side of it. The list is given no
// height: it measures the room its rows are given.
function ResourceList({ id, list }: { id: string; list: ParsedResources }) {
  const [words, setWords] = React.useState("");
  const [chosen, setChosen] = React.useState<ActionCount | undefined>();
  // A backup has no actions: none is chosen of a list that has none.
  const action = list.actions ? chosen : undefined;
  const typed = /\S/.test(words);
  const filtered = typed || action !== undefined;
  // What the words leave is what the choices count; what the action leaves of it is what is shown.
  const worded = React.useMemo(() => filterResources(list, words), [list, words]);
  const left = React.useMemo(() => (action ? filterResources(worded, "", action) : worded), [worded, action]);
  const rows = React.useMemo(() => rowsOf(left), [left]);
  const all = React.useMemo(
    () => new Map(list.resources.map((resource) => [resource.resource, resource.items.length])),
    [list],
  );
  const rowProps = React.useMemo(
    () => ({ id, rows, actions: list.actions !== undefined, filtered, all }),
    [id, rows, list, filtered, all],
  );

  return (
    // How many items and how many resources the list holds, and how many of each the filter leaves, as
    // they are: the sentence under this says them in words.
    <div
      className={styles.resources}
      data-testid={id}
      data-items={list.count}
      data-resources={list.resources.length}
      data-left-items={left.count}
      data-left-resources={left.resources.length}
    >
      <p className={styles.resourcesCount} data-testid={`${id}-count`} tabIndex={-1} {...{ [CONTENT]: "" }}>
        <span role="status">{resourcesCount(list, left, words, action)}</span>
      </p>
      {list.count ? (
        <div className={styles.resourcesFilter}>
          <div className={styles.resourcesField}>
            <span id={`${id}-filter-label`} className={styles.muted}>
              Filter by resource, namespace or name
            </span>
            {/* The host keeps an identifier it is given for itself: the field is named by its label. It
                keeps the focus when Enter is pressed in it, which the host would take from it. Escape
                clears the words, and is not the key that leaves the view while the focus is in the field. */}
            <Input
              theme="round-black"
              aria-labelledby={`${id}-filter-label`}
              data-testid={`${id}-filter`}
              value={words}
              blurOnEnter={false}
              onChange={(next) => setWords(next)}
              onKeyDown={(event) => {
                escapeOfField(event, () => setWords(""));
              }}
            />
          </div>
          {list.actions ? (
            <fieldset className={styles.resourcesActions} data-testid={`${id}-actions`}>
              <legend className={styles.spoken}>Show the items by what the restore did with them</legend>
              {CHOICES.map((choice) => (
                <button
                  key={choice ?? "all"}
                  type="button"
                  className={`${styles.resourcesAction} ${choice === action ? styles.resourcesActionChosen : ""}`}
                  aria-pressed={choice === action}
                  data-testid={`${id}-action-${(choice ?? "all").replace(" ", "-")}`}
                  // How many items the choice would leave, as the number its name ends with.
                  data-count={choice ? (worded.actions?.[choice] ?? 0) : worded.count}
                  onClick={() => setChosen(choice)}
                >
                  {actionChoice(
                    choice,
                    choice ? (worded.actions?.[choice] ?? 0) : worded.count,
                    typed ? (choice ? list.actions?.[choice] : list.count) : undefined,
                  )}
                </button>
              ))}
            </fieldset>
          ) : null}
        </div>
      ) : null}
      {rows.length ? (
        <div className={styles.resourcesTable} data-testid={`${id}-table`}>
          <TableHead nowrap>
            <TableCell className="namespace">Namespace</TableCell>
            <TableCell className="name">Name</TableCell>
            {list.actions ? <TableCell className="action">Action</TableCell> : null}
          </TableHead>
          {/* The room of the rows, between the least and the most of the rows there are. */}
          <div
            className={styles.resourcesRows}
            data-testid={`${id}-room`}
            style={{ minHeight: Math.min(rows.length, LEAST) * ROW, maxHeight: Math.min(rows.length, MOST) * ROW }}
          >
            {/* A list for each filter: the one that takes the place of another starts from its top. The part
                that scrolls is reached with the Tab key, scrolled with the keys once it is reached, and has a
                name. */}
            <List
              key={`${action ?? ""}\n${words}`}
              className={styles.resourcesList}
              role="group"
              aria-label="The resources and their items"
              tabIndex={0}
              data-testid={`${id}-rows`}
              rowComponent={ResourceRow}
              rowCount={rows.length}
              rowHeight={ROW}
              rowProps={rowProps}
              overscanCount={READY}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// The resource list of an operation: the resources by their API version and kind, each with its items,
// and for a restore what the restore did with each item. The text is parsed once, when it arrives: the
// filter works on what was read. A text that is not of the shape of the release is shown as the text it
// is.
export function ResourcesViewer({ id, text, of }: ArtifactViewerProps) {
  const list = React.useMemo(() => parseResources(text, of), [text, of]);

  if (!list) return <ArtifactLines id={id} text={text} note={otherShape(of)} />;
  return <ResourceList id={id} list={list} />;
}
