import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { hasItems } from "../../common/read-state";
import { VIEWS } from "../../common/views";
import { closeView, closeViews, openView, openViews } from "../navigation";
import { FamilyListStore } from "../state/list-store";
import { EntryState } from "./entry-state";
import { Styles } from "./styles";
import { Coverage, TargetBar } from "./target-bar";
import styles from "./views.module.css";

import type { ReactNode } from "react";

import type { Family } from "../../common/discovery";
import type { ViewKind, ViewTarget } from "../../common/views";
import type { Installation, Resource } from "../state/installation";
import type { VeleroKind } from "../state/list-store";

const {
  Component: { Icon, KubeObjectListLayout },
} = Renderer;

type HostObject = Renderer.K8sApi.KubeObject;

export interface Column {
  title: string;
  id: string;
  sortBy: string;
  className: string;
}

// The list of one kind: what the host is given to draw it, and what a row shows. The first column is the
// name, which is what opens the view of the object.
export interface ListDefinition<View extends { name: string }> {
  kind: ViewKind;
  // How the list and its page are found by the suites: the plural of the kind, in one word.
  id: string;
  object: VeleroKind<HostObject>;
  tableId: string;
  columns: Column[];
  // What a row shows of an object, with what was read of the installation for what the object refers to.
  view(resource: Resource, now: number, installation: Installation): View;
  sorting: Record<string, (view: View) => string | number>;
  search(view: View): string[];
  // The cells after the name, one for each column after the first.
  cells(view: View, item: HostObject): ReactNode[];
  // The other families a row is made from: the list says when what it shows of them is of an earlier read.
  uses?: Family[];
  // What is to be said of the list as a whole, which no row says: over the list, in words.
  notes?(installation: Installation): string[];
}

export interface OpenViewProps {
  installation: Installation;
  target: ViewTarget;
  now: number;
  // Where the way back leads, in words.
  back: string;
  onBack: () => void;
}

// The clock of the views: one reading for every row, taken again while a view is open.
export function useNow(interval = 5000): number {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);

    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

interface ListProps<View extends { name: string }> {
  definition: ListDefinition<View>;
  installation: Installation;
  now: number;
}

function FamilyListView<View extends { name: string }>({ definition, installation, now }: ListProps<View>) {
  const { kind, id, object, tableId, columns } = definition;
  const { family, title, noun } = VIEWS[kind];
  const store = React.useMemo(() => new FamilyListStore(installation, family, object), [installation, family, object]);
  const view = (item: HostObject): View => definition.view(item as unknown as Resource, now, installation);
  const sortingCallbacks = Object.fromEntries(
    Object.entries(definition.sorting).map(([column, order]) => [column, (item: HostObject) => order(view(item))]),
  );
  const read = installation.read(family);
  const notes = hasItems(read) ? (definition.notes?.(installation) ?? []) : [];

  // A list that was never read has no rows to show and no count: what it is instead is said by the notice.
  if (
    read.lastSuccess === undefined &&
    read.status !== "ready" &&
    read.status !== "loading" &&
    read.status !== "idle"
  ) {
    return (
      <div className={styles.state} data-testid={`velero-${id}-unavailable`}>
        <div className={styles.stateTitle}>
          The {noun}s of {installation.namespace} are not shown
        </div>
        <p className={styles.stateText}>
          {read.status === "forbidden"
            ? `Access to the ${noun}s of this namespace is denied. How many there are is not known.`
            : read.status === "not-served"
              ? `This cluster does not serve the ${noun}s of Velero.`
              : `The ${noun}s of this namespace could not be read. How many there are is not known.`}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* A list with nothing in it says of what it is the list: the host says that it is empty. */}
      {read.status === "ready" && read.items.length === 0 ? (
        <div role="status" className={`${styles.notice} ${styles.noticeInfo}`} data-testid={`velero-${id}-empty`}>
          <Icon material="info_outline" small />
          <span>
            No {noun} is in the namespace {installation.namespace} of {installation.cluster.name}.
          </span>
        </div>
      ) : null}
      {notes.map((note) => (
        <div
          key={note}
          role="note"
          className={`${styles.notice} ${styles.noticeInfo}`}
          data-testid={`velero-${id}-note`}
        >
          <Icon material="info_outline" small aria-hidden />
          <span>{note}</span>
        </div>
      ))}
      <KubeObjectListLayout
        tableId={tableId}
        className={styles.list}
        data-testid={`velero-${id}`}
        store={store}
        getItems={() => store.items}
        subscribeStores={false}
        // The view only reads: no row is selected, no row has a menu, and nothing can be added or removed.
        isSelectable={false}
        renderItemMenu={() => null}
        customizeHeader={({ filters: _hostNamespaces, info, ...placeholders }) => ({
          ...placeholders,
          // The host counts what the list holds: a list that was not read holds nothing, which is not none.
          info: hasItems(read) ? info : <span data-testid={`velero-${id}-not-counted`}>Not read yet</span>,
          filters: <></>,
        })}
        onDetails={(item: HostObject) => openView({ kind, name: item.getName() })}
        sortingCallbacks={sortingCallbacks}
        searchFilters={[(item: HostObject) => definition.search(view(item))]}
        renderHeaderTitle={title}
        renderTableHeader={columns}
        renderTableContents={(item: HostObject) => {
          const row = view(item);

          return [
            // The name is what the keyboard reaches: the row of the host answers to the pointer alone.
            <button
              key="name"
              type="button"
              className={styles.rowLink}
              title={row.name}
              {...{ [`data-${kind}-row`]: row.name }}
              onClick={(event) => {
                event.stopPropagation();
                openView({ kind, name: row.name });
              }}
            >
              {row.name}
            </button>,
            ...definition.cells(row, item),
          ];
        }}
      />
    </>
  );
}

const FamilyList = observer(FamilyListView) as typeof FamilyListView;

interface PageProps<View extends { name: string }> {
  definition: ListDefinition<View>;
  installation: Installation;
  // The view of one object, of whatever kind the address names.
  view(props: OpenViewProps): ReactNode;
}

// The list of one kind of the selected installation and, over it, the view of the object that is open. The
// list stays where it is while a view is open, with its search, its order and its scroll: a view opened from
// another one is over the same list, and every way back ends on it.
function FamilyPageView<View extends { name: string }>({ definition, installation, view }: PageProps<View>) {
  const now = useNow();
  const path = openViews();
  const open = path[path.length - 1];
  const before = path[path.length - 2];
  const first = path[0];
  const ready = installation.entry.state === "ready";
  const list = React.useRef<HTMLDivElement>(null);
  const opened = React.useRef<ViewTarget>();
  const shown = open ? `${open.kind}/${open.name}` : "";

  React.useEffect(() => {
    void installation.open();
    return installation.watch();
  }, [installation]);

  // The views that are open are of the installation they were opened in: with another one selected, the
  // way back would name what the other does not have.
  const namespace = installation.namespace;
  const shownOf = React.useRef(namespace);

  React.useEffect(() => {
    if (namespace === undefined) return;
    if (shownOf.current !== undefined && shownOf.current !== namespace && openViews().length) closeViews();
    shownOf.current = namespace;
  }, [namespace]);

  // Who comes back to the list is where they were: on the row they had opened.
  React.useEffect(() => {
    if (open) {
      opened.current = first;
      return;
    }
    const target = opened.current;
    let frame = 0;
    let tries = 0;
    // The list of the host may draw its rows again when it is shown: the focus is given to the row that
    // is there, and again if the row that had it was replaced and nothing has it. Once the operator
    // moved it somewhere else it is theirs: the row does not take it back.
    const focus = () => {
      const rows = [...(list.current?.querySelectorAll<HTMLElement>(`[data-${target?.kind}-row]`) ?? [])];
      const row = rows.find((candidate) => candidate.getAttribute(`data-${target?.kind}-row`) === target?.name);
      const active = document.activeElement;
      const free = active === null || active === document.body || !document.body.contains(active);

      if (tries > 0 && !free && active !== row) return;
      // The list is where it was scrolled: the focus does not move it.
      if (active !== row) row?.focus({ preventScroll: true });
      tries += 1;
      if (tries < 20) frame = requestAnimationFrame(focus);
    };

    opened.current = undefined;
    if (!target) return;
    focus();
    return () => cancelAnimationFrame(frame);
  }, [shown]);

  // The host lays the page out, with the tabs of the group over it: a layout of the host inside that
  // one would give the page its margins twice, and less room than it has.
  return (
    <>
      <Styles />
      <div className={styles.page} data-testid={`velero-${definition.id}-page`}>
        <TargetBar installation={installation} />
        <Coverage
          installation={installation}
          families={open ? [...VIEWS[open.kind].reads] : [VIEWS[definition.kind].family]}
          earlier={open ? [] : definition.uses}
        />
        {ready ? (
          <div className={styles.content}>
            <div
              ref={list}
              className={`${styles.content} ${open ? styles.behind : ""}`}
              aria-hidden={open ? true : undefined}
            >
              <FamilyList definition={definition} installation={installation} now={now} />
            </div>
            {open ? (
              <div className={styles.over}>
                {view({
                  installation,
                  target: open,
                  now,
                  back: before ? `${VIEWS[before.kind].title} / ${before.name}` : VIEWS[definition.kind].title,
                  onBack: closeView,
                })}
              </div>
            ) : null}
          </div>
        ) : (
          <EntryState installation={installation} />
        )}
      </div>
    </>
  );
}

export const FamilyPage = observer(FamilyPageView) as typeof FamilyPageView;
