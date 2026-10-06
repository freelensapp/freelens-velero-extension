// What stands for the components of the host in the tests of the views: the markup a test can read and
// act on, and a record of what each list was given. Nothing of the host is drawn: what is under test is
// what the extension gives to the host, and what it shows around it.

import React from "react";

import type { ReactNode } from "react";

interface Passed {
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
  [name: string]: unknown;
}

// The props the lists of the host were last rendered with, by their table.
export const listProps = new Map<string, Record<string, unknown>>();

function Button({ label, children, onClick, primary: _primary, plain: _plain, tooltip: _tooltip, ...rest }: Passed) {
  return (
    <button type="button" onClick={onClick as () => void} {...rest}>
      {label as ReactNode}
      {children}
    </button>
  );
}

function Icon({ material, small: _small, ...rest }: Passed) {
  return (
    <i className="Icon" {...rest}>
      {material as ReactNode}
    </i>
  );
}

// The input of the host, which calls what it was given for its keys and then leaves the focus at Enter,
// unless it is told not to.
function Input({ value, onChange, onKeyDown, theme: _theme, blurOnEnter = true, ...rest }: Passed) {
  return (
    <input
      value={value as string}
      onChange={(event) => (onChange as (next: string) => void)(event.target.value)}
      onKeyDown={(event) => {
        (onKeyDown as ((event: unknown) => void) | undefined)?.(event);
        if (event.shiftKey || event.metaKey || event.altKey || event.ctrlKey) return;
        if (event.key === "Enter" && blurOnEnter) event.currentTarget.blur();
      }}
      {...rest}
    />
  );
}

interface Option {
  value: string;
  label: string;
}

function Select({ options, value, onChange, placeholder, isDisabled, inputId, ...rest }: Passed) {
  const { themeName: _theme, className: _class, id: _id, ...passed } = rest;

  return (
    <select
      id={inputId as string}
      value={(value as string | null) ?? ""}
      disabled={isDisabled as boolean}
      onChange={(event) =>
        (onChange as (option?: Option) => void)(
          (options as Option[]).find((option) => option.value === event.target.value),
        )
      }
      {...passed}
    >
      <option value="">{placeholder as string}</option>
      {(options as Option[]).map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

interface Item {
  getId(): string;
  getName(): string;
}

interface Header {
  title?: ReactNode;
  info?: ReactNode;
  filters?: ReactNode;
  searchProps?: object;
}

// The list of the host, as far as the extension decides it: the rows it gives, the columns, what a row opens.
function KubeObjectListLayout(props: Passed) {
  const items = (props.getItems as () => Item[])();
  const header = props.renderTableHeader as { title: string; id: string; className: string }[];
  const contents = props.renderTableContents as (item: Item) => ReactNode[];

  // The header as the host makes it: its own count of the items, then what the list makes of it.
  const customize = (props.customizeHeader ?? ((placeholders: Header) => placeholders)) as (
    placeholders: Header,
  ) => Header;
  const { title, info, filters } = customize({
    title: <h5>{props.renderHeaderTitle as ReactNode}</h5>,
    info: items.length === 1 ? "1 item" : `${items.length} items`,
    searchProps: {},
  });

  listProps.set(props.tableId as string, props);
  return (
    <div className={props.className} data-testid={props["data-testid"]}>
      {title}
      {info && <div className="info-panel">{info}</div>}
      {filters}
      <div className="TableHead">
        {header.map((column) => (
          <div key={column.id} className={`TableCell ${column.className}`}>
            {column.title}
          </div>
        ))}
      </div>
      {items.map((item) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: the row of the host answers to the pointer
        // biome-ignore lint/a11y/useKeyWithClickEvents: and to nothing else
        <div key={item.getId()} className="TableRow" onClick={() => (props.onDetails as (item: Item) => void)(item)}>
          {contents(item).map((cell, index) => (
            <div key={header[index].id} className={`TableCell ${header[index].className}`}>
              {cell}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function DrawerItem({ name, children }: Passed) {
  return (
    <div className="DrawerItem" data-name={name as string}>
      <span className="name">{name as ReactNode}</span>
      <span className="value">{children}</span>
    </div>
  );
}

function MaybeLink({ to, children, ...rest }: Passed) {
  return (
    <a href={to as string} {...rest}>
      {children}
    </a>
  );
}

// The spinner of the host, which gives its element what it is given: a view that hides it from who does
// not see hides it here as well. Its role and its name are of this double, for the tests to find it by.
function Spinner({ center: _center, singleColor: _singleColor, className: _className, ...rest }: Passed) {
  return <div role="progressbar" aria-label="Loading" {...rest} className="Spinner" />;
}

function KubeObjectAge({ object }: Passed) {
  return <span>{(object as { metadata?: { creationTimestamp?: string } }).metadata?.creationTimestamp ?? ""}</span>;
}

// The confirmation dialog of the host: what an extension opens it with is recorded, and a test answers
// it by calling what it was given. Nothing is drawn.
export interface ConfirmDialogParams {
  message: ReactNode;
  labelOk?: ReactNode;
  labelCancel?: ReactNode;
  ok?: () => unknown;
  cancel?: () => unknown;
}
export const confirmDialogs: ConfirmDialogParams[] = [];

const ConfirmDialog = Object.assign((_props: Passed) => null, {
  open: (params: ConfirmDialogParams) => {
    confirmDialogs.push(params);
  },
});

// The tabs of the host, with the markup and the behaviour of its release: a strip that gives its tabs the
// one that is shown and what changes it, and a tab with its role, in the order of the keyboard, which a
// click, Enter and Space choose, and which calls what it was given for its keys after its own.
const TabsContext = React.createContext<{ value?: unknown; onChange?: (value: unknown) => void }>({});

function Tabs({ value, onChange, center: _center, wrap: _wrap, scrollable: _scrollable, children, ...rest }: Passed) {
  return (
    <TabsContext.Provider value={{ value, onChange: onChange as (value: unknown) => void }}>
      <div className="Tabs" {...rest}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

function Tab({ value, label, active, disabled, icon: _icon, onClick, onKeyDown, ...rest }: Passed) {
  const context = React.useContext(TabsContext);
  const shown = typeof active === "boolean" ? active : context.value === value;

  return (
    <div
      {...rest}
      className={`Tab${shown ? " active" : ""}`}
      tabIndex={0}
      role="tab"
      onClick={(event) => {
        if (disabled || active) return;
        (onClick as ((event: unknown) => void) | undefined)?.(event);
        context.onChange?.(value);
      }}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") event.currentTarget.click();
        (onKeyDown as ((event: unknown) => void) | undefined)?.(event);
      }}
    >
      <div className="label">{label as ReactNode}</div>
    </div>
  );
}

// The table of the host and its parts, with the markup and the traps of its release. The table draws its
// head and the rows it holds, and nothing else: what is not a row is dropped, a fragment of rows as well,
// and its element is given its classes and nothing of what the table was passed. A head and a row give
// their element what they were passed; a cell shows its title in place of what it holds when it is given
// one.
function classes(...names: unknown[]): string {
  return names.filter((name) => typeof name === "string" && name).join(" ");
}

function TableHead({ className, sticky = true, nowrap, showTopLine, flat, children, ...rest }: Passed) {
  return (
    <div
      className={classes(
        "TableHead",
        className,
        sticky && "sticky",
        nowrap && "nowrap",
        showTopLine && "topLine",
        flat && "flat",
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

function TableRow({ className, nowrap, selected, disabled, children, testId, ...rest }: Passed) {
  const { sortItem: _sortItem, searchItem: _searchItem, ...passed } = rest;

  return (
    <div
      className={classes("TableRow", className, selected && "selected", nowrap && "nowrap", disabled && "disabled")}
      data-testid={testId as string}
      {...passed}
    >
      {children}
    </div>
  );
}

function TableCell({ className, title, children, checkbox, scrollable, ...rest }: Passed) {
  const {
    isChecked: _isChecked,
    sortBy: _sortBy,
    showWithColumn: _showWithColumn,
    resizable: _resizable,
    ...more
  } = rest;
  const { onResizeStart: _onResizeStart, onResizeReset: _onResizeReset, ...passed } = more;

  return (
    <div {...passed} className={classes("TableCell", className, checkbox && "checkbox", scrollable && "scrollable")}>
      {(title as ReactNode) || children}
    </div>
  );
}

function Table({ children, className, selectable, scrollable, autoSize, noItems }: Passed) {
  const content = React.Children.toArray(children) as React.ReactElement[];
  const rows = content.filter((element) => element.type === TableRow);

  return (
    <div
      className={classes(
        "Table flex column",
        className,
        selectable && "selectable",
        scrollable !== false && "scrollable",
        autoSize !== false && "autoSize",
      )}
    >
      {content.find((element) => element.type === TableHead) ?? null}
      {rows.length ? rows : (noItems as ReactNode)}
    </div>
  );
}

// The virtual list of the host, as far as a view decides it: of the rows it was given the heights of, the
// ones its room shows and as many before and after them as the host keeps ready, each placed by the
// heights before it, and no other. A row is asked for by its place when the items are texts, by its
// identifier when they are objects. The room is the one the list is given as its height, or the one a
// test gives it, as tall by default as the tallest list of the extension. A list that is given no height
// measures its room once it is mounted, as the one of the host does, and draws nothing of itself before,
// nor while it has no room: its rows are there a moment after what holds it. It measures again when the
// window is resized, which is how a test says that the room changed. It is scrolled as the one of the
// host is: by its element, and by what it hands the view that holds it. Two things it does not do as the
// host does: it keeps the rows ready on both sides at all times, where the host keeps one behind while it
// is scrolled and the others when it rests, so that a count of rows read here right after a scroll is the
// one the host shows once it rests, and never fewer than it shows meanwhile; and it is as tall as its rows
// are, where the host sizes itself by an estimate of the rows it has not measured yet.
export const virtualList = { room: 1560 };

interface VirtualListHandle {
  scrollToItem(index: number, align?: string): void;
  resetAfterIndex(index: number): void;
}

const VirtualList = React.forwardRef<VirtualListHandle, Passed>(function VirtualList(
  { items, rowHeights, getRow, onScroll, outerRef, className, readyOffset = 10, fixedHeight },
  ref,
) {
  const heights = rowHeights as number[];
  const entries = items as (string | { getId(): string })[];
  const count = entries.length;
  const room = (fixedHeight as number | undefined) ?? virtualList.room;
  const ready = readyOffset as number;
  const [asked, setAsked] = React.useState(0);
  const [, draw] = React.useState(0);
  const [measured, setMeasured] = React.useState(false);
  const drawn = typeof fixedHeight === "number" || measured;
  const outer = React.useRef<HTMLDivElement | null>(null);
  let total = 0;

  for (let row = 0; row < count; row += 1) total += heights[row];
  // Where the list is scrolled to, which is never past its end.
  const offset = Math.max(0, Math.min(asked, total - room));
  let first = 0;
  let above = 0;

  while (first < count - 1 && above + heights[first] <= offset) above += heights[first++];
  let last = first;

  for (let below = above + (heights[first] ?? 0); last < count - 1 && below < offset + room; ) below += heights[++last];
  const from = Math.max(0, first - ready);
  const to = Math.min(count - 1, last + ready);
  const rows: ReactNode[] = [];
  let top = above;

  for (let row = from; row < first; row += 1) top -= heights[row];
  for (let row = from; row <= to; row += 1) {
    const entry = entries[row];
    const element = (getRow as ((place: number | string) => React.ReactElement | null | undefined) | undefined)?.(
      typeof entry === "string" ? row : entry.getId(),
    );

    if (element) {
      rows.push(
        React.cloneElement(element, {
          key: row,
          style: { ...element.props.style, position: "absolute", left: 0, top, height: heights[row], width: "100%" },
        }),
      );
    }
    top += heights[row];
  }
  React.useImperativeHandle(ref, () => ({
    // The alignments of the list of the host: a row is brought to the start, to the end or to the middle
    // of the room, or as little as shows it; the last is what is done for a row that is near, and the
    // middle for one that is far.
    scrollToItem(index, align = "auto") {
      let start = 0;

      for (let row = 0; row < index; row += 1) start += heights[row];
      const most = Math.max(0, Math.min(total - room, start));
      const least = Math.max(0, start - room + heights[index]);
      const near = offset >= least - room && offset <= most + room;
      const how = align === "smart" ? (near ? "auto" : "center") : align;

      setAsked(
        how === "start"
          ? most
          : how === "end"
            ? least
            : how === "center"
              ? Math.round(least + (most - least) / 2)
              : offset < least
                ? least
                : offset > most
                  ? most
                  : offset,
      );
    },
    resetAfterIndex: () => draw((drawn) => drawn + 1),
  }));
  // The room is measured when what holds the list is in the page, before anything is painted.
  React.useLayoutEffect(() => {
    const measure = () => setMeasured(virtualList.room > 0);

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  // The element is where the list is scrolled to, as the one of a browser is, and the view is told when
  // that changes, by what it gave when the list was last drawn.
  React.useEffect(() => {
    if (outer.current && outer.current.scrollTop !== offset) outer.current.scrollTop = offset;
  });
  React.useEffect(() => {
    if (drawn) (onScroll as ((scroll: { scrollOffset: number }) => void) | undefined)?.({ scrollOffset: offset });
  }, [offset, drawn]);

  return (
    <div className={`VirtualList${className ? ` ${className}` : ""}`}>
      {drawn ? (
        <div
          className="list"
          style={{ position: "relative", height: room, overflow: "auto" }}
          ref={(element) => {
            const given = outerRef as React.Ref<HTMLDivElement> | undefined;

            outer.current = element;
            if (typeof given === "function") given(element);
            else if (given) (given as React.MutableRefObject<HTMLDivElement | null>).current = element;
          }}
          onScroll={(event) => setAsked(event.currentTarget.scrollTop)}
        >
          <div style={{ height: total, width: "100%" }}>{rows}</div>
        </div>
      ) : null}
    </div>
  );
});

export const hostComponents: Record<string, (props: Passed) => ReactNode> = {
  Button,
  ConfirmDialog,
  DrawerItem,
  Icon,
  Input,
  KubeObjectAge,
  KubeObjectListLayout,
  MaybeLink,
  Select,
  Spinner,
  Tab,
  Table,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  VirtualList,
};
