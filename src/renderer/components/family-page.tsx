import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { hasItems } from "../../common/read-state";
import { VIEWS } from "../../common/views";
import { openView } from "../navigation";
import { FamilyListStore } from "../state/list-store";
import styles from "./views.module.css";
import { ViewsFrame } from "./views-frame";

import type { ReactNode } from "react";

import type { Family } from "../../common/discovery";
import type { ViewKind } from "../../common/views";
import type { Installation, Resource } from "../state/installation";
import type { VeleroKind } from "../state/list-store";
import type { OpenViewProps } from "./views-frame";

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

export { useNow } from "./views-frame";

export type { OpenViewProps } from "./views-frame";

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
  const { kind, id, uses } = definition;

  return (
    <ViewsFrame
      id={id}
      title={VIEWS[kind].title}
      installation={installation}
      families={[VIEWS[kind].family]}
      earlier={uses}
      view={view}
      // Who comes back to the list is where they were: on the row they had opened.
      origin={(root, target) =>
        [...root.querySelectorAll<HTMLElement>(`[data-${target.kind}-row]`)].find(
          (row) => row.getAttribute(`data-${target.kind}-row`) === target.name,
        )
      }
    >
      {(now) => <FamilyList definition={definition} installation={installation} now={now} />}
    </ViewsFrame>
  );
}

export const FamilyPage = observer(FamilyPageView) as typeof FamilyPageView;
