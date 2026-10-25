// What stands for the components of the host in the tests of the views, written from their source at the
// validation target, freelensapp/freelens at 7801fb10a5f20af308093b39e5f79cd6e8c3461d. Each draws the markup
// the component of the host draws for the props the extension gives it, with the classes the host gives,
// and does what it does with the events a test sends; each names the file and the lines it follows. What a
// component does that no test can see, its styles and its layout, is not drawn, and what it would do with a
// prop the extension does not give is said where it is left out. The class names of the CSS modules of the
// host are written as their local names: the build of the host gives them a name of its own.

import React from "react";
import { createPortal } from "react-dom";
import { addressPath, createPageParam, pushAddress } from "./host-address";

import type { Renderer } from "@freelensapp/extensions";

import type { ReactNode } from "react";

interface Passed {
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
  [name: string]: unknown;
}

type Handler = (event: never) => unknown;

// What a double of the host does not draw, asked of it: a prop that changes what the host draws, which the
// extension does not give.
function notModeled(component: string, what: string): never {
  throw new Error(`The double of ${component} draws no ${what}: write it from the source of the host first`);
}

// `cssNames` (packages/utility-features/utilities/src/cssNames.ts lines 14 to 36): every name a string or an
// array gives, and every key of an object with a true value, in the order each name was first given, once.
export function cssNames(...names: unknown[]): string {
  const enabled = new Map<string, boolean>();

  for (const name of names) {
    if (typeof name === "string") enabled.set(name, true);
    else if (Array.isArray(name)) for (const one of name) enabled.set(one, true);
    else if (name && typeof name === "object")
      for (const [key, value] of Object.entries(name)) enabled.set(key, Boolean(value));
  }
  return [...enabled.entries()]
    .filter(([, on]) => on)
    .map(([name]) => name.trim())
    .filter(Boolean)
    .join(" ");
}

// `isReactNode` (packages/utility-features/utilities/src/isReactNode.ts lines 26 to 33).
function isReactNode(node: unknown): boolean {
  return (
    (typeof node === "object" && node !== null && React.isValidElement(node)) ||
    (Array.isArray(node) && node.every(isReactNode)) ||
    node == null ||
    typeof node !== "object"
  );
}

// `prevDefault` and `stopPropagation` (packages/utility-features/utilities/src/prevDefault.ts lines 21 to 32).
function prevDefault<E extends { preventDefault(): void; stopPropagation(): void }>(callback: (event: E) => unknown) {
  return (event: E) => {
    event.preventDefault();
    event.stopPropagation();
    return callback(event);
  };
}

function stopPropagation(event: { stopPropagation(): void }): void {
  event.stopPropagation();
}

// The tooltip of the host (packages/ui-components/tooltip/src/tooltip.tsx lines 57 to 174): nothing until the
// pointer enters its target, or the parent of its target; then the words, with the role of a tooltip, in the
// body of the document. Where the host places it, which it measures, is not drawn.
function Tooltip({
  targetId,
  tooltipOnParentHover,
  visible,
  formatters,
  className,
  style,
  children,
  "data-testid": testId,
}: Passed & { targetId: string }) {
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    const target = document.getElementById(targetId);
    const hovered = tooltipOnParentHover ? target?.parentElement : target;
    const enter = () => setShown(true);
    const leave = () => setShown(false);

    hovered?.addEventListener("mouseenter", enter);
    hovered?.addEventListener("mouseleave", leave);
    return () => {
      hovered?.removeEventListener("mouseenter", enter);
      hovered?.removeEventListener("mouseleave", leave);
    };
  }, [targetId, tooltipOnParentHover]);
  if (!(visible ?? shown)) return null;
  return createPortal(
    <div
      className={cssNames("Tooltip", className, formatters, { visible: shown || visible, formatter: !!formatters })}
      style={style as React.CSSProperties}
      role="tooltip"
      data-testid={testId}
    >
      {children}
    </div>,
    document.body,
  );
}

// The identifier of the target of a tooltip, `uniqueId("tooltip_target_")` of es-toolkit: one more each time.
let tooltipTargets = 0;

// `withTooltip` (packages/ui-components/tooltip/src/withTooltip.tsx lines 24 to 70): a component given a tooltip
// has an identifier, its children in a `div`, and the tooltip after them.
function withTooltip(Target: (props: Passed) => ReactNode) {
  return function WithTooltipDecorator(props: Passed) {
    const [defaultTooltipId] = React.useState(() => `tooltip_target_${++tooltipTargets}`);
    let { id: targetId, children: targetChildren } = props;
    const {
      tooltip,
      tooltipOverrideDisabled,
      tooltipFormatters = { narrow: true },
      id: _id,
      children: _children,
      ...targetProps
    } = props;

    if (tooltip) {
      const tooltipProps = {
        targetId: (targetId as string) || defaultTooltipId,
        tooltipOnParentHover: tooltipOverrideDisabled,
        formatters: tooltipFormatters,
        ...(isReactNode(tooltip) ? { children: tooltip as ReactNode } : (tooltip as object)),
      };

      targetId = tooltipProps.targetId;
      targetChildren = (
        <>
          <div>{targetChildren}</div>
          <Tooltip {...tooltipProps} />
        </>
      );
    }
    return (
      <Target id={targetId} {...targetProps}>
        {targetChildren}
      </Target>
    );
  };
}

// `Button` (packages/ui-components/button/src/button.tsx lines 30 to 67), inside `withTooltip`.
const Button = withTooltip(
  ({
    waiting,
    label,
    primary,
    accent,
    plain,
    hidden,
    active,
    big,
    round,
    outlined,
    light,
    children,
    ...buttonProps
  }: Passed) => {
    if (hidden) return null;
    const className = cssNames("Button", buttonProps.className, {
      waiting,
      primary,
      accent,
      plain,
      active,
      big,
      round,
      outlined,
      light,
    });

    if (buttonProps.href)
      return (
        <a {...buttonProps} className={className}>
          {label as ReactNode}
          {children}
        </a>
      );
    return (
      <button
        type="button"
        {...buttonProps}
        className={className}
        data-waiting={typeof waiting === "boolean" ? String(waiting) : undefined}
      >
        {label as ReactNode}
        {children}
      </button>
    );
  },
);

// `Icon` (packages/ui-components/icon/src/icon.tsx lines 175 to 303), inside `withTooltip`. The icon of a
// material name holds the name as its text, which a font draws as the icon. An icon with a handler of a click,
// a link or `interactive` is in the order of the Tab key, and Space and Enter click it.
const Icon = withTooltip((props: Passed) => {
  const {
    className,
    href,
    link,
    material,
    svg,
    size,
    smallest,
    small,
    big,
    disabled,
    welcomeLogo,
    sticker,
    active,
    focusable = true,
    children,
    interactive,
    onClick,
    onKeyDown,
    ...elemProps
  } = props;
  const ref = React.useRef<HTMLElement>(null);
  const isInteractive = (interactive as boolean | undefined) ?? !!(onClick || href || link);

  if (href || link) notModeled("Icon", "link");
  const iconProps = {
    className: cssNames(
      welcomeLogo ? undefined : "Icon",
      className,
      { svg, material, interactive: isInteractive, disabled, sticker, active, focusable },
      size ? {} : { smallest, small, big },
    ),
    onClick: isInteractive
      ? (event: React.MouseEvent) => {
          if (!disabled) (onClick as ((event: React.MouseEvent) => void) | undefined)?.(event);
        }
      : undefined,
    onKeyDown: isInteractive
      ? (event: React.KeyboardEvent) => {
          if (event.nativeEvent.code === "Space" || event.nativeEvent.code === "Enter") {
            ref.current?.click();
            event.preventDefault();
          }
          (onKeyDown as ((event: React.KeyboardEvent) => void) | undefined)?.(event);
        }
      : undefined,
    tabIndex: isInteractive && focusable && !disabled ? 0 : undefined,
    style: size ? ({ "--size": `${size}${typeof size === "number" ? "px" : ""}` } as React.CSSProperties) : undefined,
    ...elemProps,
  };
  let content: ReactNode = null;

  if (typeof svg === "string")
    content = <span className="icon" dangerouslySetInnerHTML={{ __html: svg.includes("<svg") ? svg : "" }} />;
  if (typeof material === "string")
    content = (
      <span className="icon" data-icon-name={material}>
        {material}
      </span>
    );
  return (
    <i {...iconProps} ref={ref}>
      {content}
      {children}
    </i>
  );
});

// `Spinner` (packages/ui-components/spinner/src/spinner.tsx lines 17 to 29): an element and its classes, and
// nothing else: no role and no name.
function Spinner({ singleColor = true, center = false, className, ...props }: Passed) {
  return <div {...props} className={cssNames("Spinner", className, { singleColor, center })} />;
}

// `Input` (packages/core/src/renderer/components/input/input.tsx lines 93 to 477), as the extension gives it:
// controlled or not, with no validator, on one line. Its element is in a label, in an element with the classes
// of its theme. It calls what it was given for its keys first, then, but for a key with a modifier or one held
// down, takes Enter as the end of the edit and leaves the focus unless it is told not to. The mark of a change
// the host sets 500 milliseconds after it, for its styles of validation, shows nothing without a validator and
// is not drawn.
function Input(props: Passed) {
  const {
    multiLine,
    showValidationLine,
    validators,
    theme,
    maxRows,
    children: _children,
    showErrorsAsTooltip,
    maxLength,
    rows: _rows,
    disabled,
    autoSelectOnFocus,
    iconLeft,
    iconRight,
    contentRight,
    id,
    dirty,
    trim,
    blurOnEnter = true,
    onChange,
    onKeyDown,
    onSubmit,
    onFocus,
    onBlur,
    ...inputProps
  } = props;
  const [focused, setFocused] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  if (multiLine) notModeled("Input", "text of many lines");
  if (validators || showErrorsAsTooltip || maxLength || dirty || trim || showValidationLine === false)
    notModeled("Input", "validation");
  void maxRows;
  const icon = (data: unknown) =>
    typeof data === "string" ? (
      <Icon material={data} />
    ) : typeof data === "function" ? (
      notModeled("Input", "icon made by a function")
    ) : (
      (data as ReactNode)
    );
  const controlled = inputProps.value !== undefined;
  const className = cssNames("Input", props.className, {
    ...(theme ? { theme: true, round: true, black: theme === "round-black" } : {}),
    focused,
    disabled,
  });

  return (
    <div id={id || showErrorsAsTooltip ? `input_tooltip_id_${crypto.randomUUID()}` : undefined} className={className}>
      <label className="input-area flex items-center gap-2" id="">
        {icon(iconLeft)}
        <input
          {...inputProps}
          className="input grow"
          ref={input}
          spellCheck="false"
          disabled={disabled as boolean | undefined}
          onFocus={(event) => {
            (onFocus as Handler | undefined)?.(event as never);
            if (autoSelectOnFocus) input.current?.select();
            setFocused(true);
          }}
          onBlur={(event) => {
            (onBlur as Handler | undefined)?.(event as never);
            setFocused(false);
          }}
          onChange={(event) => {
            const value = event.currentTarget.value;
            const copy = { ...event };

            // An input that is not controlled is validated before it says its value, after a turn.
            if (controlled) (onChange as ((value: string, event: unknown) => void) | undefined)?.(value, copy);
            else
              void Promise.resolve().then(() =>
                (onChange as ((value: string, event: unknown) => void) | undefined)?.(value, copy),
              );
          }}
          onKeyDown={(event) => {
            (onKeyDown as Handler | undefined)?.(event as never);
            if (event.shiftKey || event.metaKey || event.altKey || event.ctrlKey || event.repeat) return;
            if (event.key !== "Enter") return;
            (onSubmit as ((value: string, event: unknown) => void) | undefined)?.(
              (inputProps.value as string | undefined) ?? event.currentTarget.value,
              event,
            );
            if (!controlled) event.currentTarget.value = "";
            if (blurOnEnter) input.current?.blur();
          }}
        />
        {icon(iconRight)}
        {contentRight as ReactNode}
      </label>
      <div className="input-info flex gap-2" />
    </div>
  );
}

interface Option {
  value: string;
  label: string;
}

// `Select` (packages/core/src/renderer/components/select/select.tsx lines 127 to 280), the select of react-select
// of the host, drawn as the select of the document: the same choice by the value of an option, the option given
// to what it was given for a change, its words while nothing is chosen, and the identifier of its field, which
// the host takes from `id` and from nothing else (lines 218, 246 and 247), with the classes of its theme. The
// menu of react-select, its search and its keys are not drawn.
function Select({ options, value, onChange, placeholder, isDisabled, id, themeName, className, ...rest }: Passed) {
  const {
    inputId: _taken,
    isMulti,
    menuClass: _menuClass,
    menuPortalTarget: _portal,
    menuPlacement: _placement,
    ...passed
  } = rest;

  if (isMulti) notModeled("Select", "choice of many");
  return (
    <select
      {...passed}
      id={id as string | undefined}
      className={cssNames("Select", `theme-${(themeName as string | undefined) ?? "dark"}`, className)}
      value={(value as string | null) ?? ""}
      disabled={isDisabled as boolean | undefined}
      onChange={(event) => {
        const option = (options as Option[]).find((one) => one.value === event.target.value) ?? null;

        (onChange as (option: Option | null, meta: { action: string; option?: Option }) => void)(option, {
          action: "select-option",
          option: option ?? undefined,
        });
      }}
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

// `Tabs` and `Tab` (packages/core/src/renderer/components/tabs/tabs.tsx lines 34 to 150): a strip that gives its
// tabs the one that is shown and what changes it, and a tab with its role, in the order of the keyboard, which a
// click, Enter and Space choose, and which calls what it was given for its keys after its own. The strip has no
// role, and no tab says that it is selected.
const TabsContext = React.createContext<{ value?: unknown; onChange?: (value: unknown) => void; autoFocus?: boolean }>(
  {},
);

function Tabs({ center, wrap, onChange, value, autoFocus, scrollable = true, withBorder, ...elemProps }: Passed) {
  return (
    <TabsContext value={{ autoFocus: autoFocus as boolean, value, onChange: onChange as (value: unknown) => void }}>
      <div {...elemProps} className={cssNames("Tabs", elemProps.className, { center, wrap, scrollable, withBorder })} />
    </TabsContext>
  );
}

function Tab({ active, disabled, icon, label, value, ...elemProps }: Passed) {
  const context = React.useContext(TabsContext);
  const ref = React.useRef<HTMLDivElement>(null);
  const isActive = typeof active === "boolean" ? active : context.value === value;

  // The host gives the focus when the tab is mounted, and only then.
  React.useEffect(() => {
    if (isActive && context.autoFocus) ref.current?.focus();
  }, []);
  return (
    <div
      {...elemProps}
      className={cssNames("Tab flex gap-2 items-center", elemProps.className, { active: isActive, disabled })}
      tabIndex={0}
      onClick={(event) => {
        if (disabled || active) return;
        (elemProps.onClick as Handler | undefined)?.(event as never);
        context.onChange?.(value);
      }}
      onFocus={(event) => {
        (elemProps.onFocus as Handler | undefined)?.(event as never);
      }}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") ref.current?.click();
        (elemProps.onKeyDown as Handler | undefined)?.(event as never);
      }}
      role="tab"
      ref={ref}
    >
      {typeof icon === "string" ? <Icon small material={icon} /> : (icon as ReactNode)}
      <div className="label">{label as ReactNode}</div>
    </div>
  );
}

// `TableHead` (packages/core/src/renderer/components/table/table-head.tsx lines 22 to 42).
function TableHead({ className, sticky = true, nowrap, showTopLine, flat, children, ...headProps }: Passed) {
  return (
    <div className={cssNames("TableHead", className, { sticky, nowrap, topLine: showTopLine, flat })} {...headProps}>
      {children}
    </div>
  );
}

// `TableRow` (packages/core/src/renderer/components/table/table-row.tsx lines 37 to 48): its element is given
// what it was passed, after the identifier of the tests it was given.
function TableRow({
  className,
  nowrap,
  selected,
  disabled,
  children,
  sortItem,
  searchItem,
  testId,
  ...rowProps
}: Passed) {
  void sortItem;
  void searchItem;
  return (
    <div
      className={cssNames("TableRow", className, { selected, nowrap, disabled })}
      data-testid={testId as string | undefined}
      {...rowProps}
    >
      {children}
    </div>
  );
}

// `TableCell` (packages/core/src/renderer/components/table/table-cell.tsx lines 19 to 129): a cell shows its title
// in place of what it holds when it is given one; a cell of a head that sorts says how, and sorts at a click.
function TableCell(props: Passed) {
  const {
    className,
    checkbox,
    isChecked,
    scrollable,
    sortBy,
    _sort,
    _sorting,
    _nowrap,
    children,
    title,
    showWithColumn: _showWithColumn,
    resizable,
    onResizeStart: _onResizeStart,
    onResizeReset: _onResizeReset,
    style,
    onClick,
    ...cellProps
  } = props;
  const content = (title as ReactNode) || children;
  const sorting = _sorting as { sortBy?: string; orderBy?: string } | undefined;

  if (checkbox && isChecked !== undefined) notModeled("TableCell", "box of a choice");
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the cell of the host answers to the pointer
    // biome-ignore lint/a11y/useKeyWithClickEvents: and to nothing else
    <div
      {...cellProps}
      className={cssNames("TableCell", className, {
        checkbox,
        scrollable,
        nowrap: _nowrap,
        sorting: _sort && typeof sortBy === "string",
      })}
      style={style as React.CSSProperties}
      onClick={(event) => {
        (onClick as Handler | undefined)?.(event as never);
        if (typeof _sort === "function" && typeof sortBy === "string") _sort(sortBy);
      }}
    >
      {_nowrap ? <div className="content">{content}</div> : content}
      {sorting && sortBy ? (
        <Icon
          className={cssNames("sortIcon", { enabled: sorting.sortBy === sortBy })}
          material={sorting.sortBy !== sortBy || sorting.orderBy === "desc" ? "arrow_drop_down" : "arrow_drop_up"}
        />
      ) : null}
      {resizable ? <div className="resize-handle" /> : null}
    </div>
  );
}

type SortParams = { sortBy?: string; orderBy?: "asc" | "desc" };

// What the model of the tables of the host keeps of each table, by its identifier, which outlives a list
// (table-model/table-model.ts lines 18 to 28): how it is sorted.
const sortParams = new Map<string, SortParams>();

// `Ordering`, `sortCompare` and `rectifyOrdering` (packages/utility-features/utilities/src/sort-compare.ts lines
// 22 to 49), and `getSorted` (packages/core/src/renderer/components/table/sorting.ts lines 10 to 52).
function sortCompare(left: unknown, right: unknown): number {
  if ((left as number) < (right as number)) return -1;
  if (left === right) return 0;
  return 1;
}

function getSorted<T>(items: T[], callback: ((item: T) => unknown) | undefined, orderBy: "asc" | "desc"): T[] {
  if (typeof callback !== "function") return items;
  const turn = (ordering: number) => (orderBy === "desc" ? -ordering : ordering);
  const data = items.map((item, index) => ({ index, sortBy: callback(item) }));

  data.sort((left, right) => {
    if (!Array.isArray(left.sortBy) && !Array.isArray(right.sortBy))
      return turn(sortCompare(left.sortBy, right.sortBy));
    const lefts = [left.sortBy].flat();
    const rights = [right.sortBy].flat();

    for (let index = 0; index < Math.min(lefts.length, rights.length); index++) {
      const ordering = turn(sortCompare(lefts[index], rights[index]));

      if (ordering !== 0) return ordering;
    }
    return lefts.length - rights.length;
  });
  return data.map(({ index }) => items[index]);
}

const sortParam = createPageParam({ name: "sort" });
const orderParam = createPageParam({ name: "order" });

// `Table` (packages/core/src/renderer/components/table/table.tsx lines 128 to 314): the head and the rows it
// holds, and nothing else: what is not a row is dropped, a fragment of rows as well. A table with an identifier
// and the callbacks of its order sorts its rows as its model keeps it, and a click on a cell of its head that
// names a column sorts by it, again for the other way, and writes it into the address. A table that is virtual
// has its rows drawn by the virtual list of the host, as the list of a kind gives them.
function Table(props: Passed) {
  const {
    children,
    className,
    selectable,
    scrollable = true,
    autoSize = true,
    virtual,
    tableId,
    sortable,
    noItems,
    items = [],
    renderRow,
    getTableRow,
    sortByDefault,
  } = props;
  const isSortable = Boolean(sortable && tableId);
  const [, sorted] = React.useState(0);
  const params: SortParams = Object.assign({}, sortByDefault, tableId ? sortParams.get(tableId as string) : undefined);
  const content = React.Children.toArray(children) as React.ReactElement<Passed>[];

  if (renderRow)
    content.push(
      ...(items as unknown[]).map(renderRow as (item: unknown) => React.ReactElement<Passed>).filter(Boolean),
    );
  const sort = (column: string) => {
    const orderBy = !params.orderBy || params.sortBy !== column || params.orderBy === "desc" ? "asc" : "desc";

    sortParams.set(tableId as string, { sortBy: column, orderBy });
    sortParam.set(column);
    orderParam.set(orderBy);
    sorted((count) => count + 1);
  };
  const head = content.find((element) => element.type === TableHead);
  const renderedHead =
    head && isSortable
      ? React.cloneElement(head, {
          children: (React.Children.toArray(head.props.children) as React.ReactElement<Passed>[]).map((cell) =>
            cell.props.checkbox
              ? cell
              : React.cloneElement(cell, {
                  title:
                    cell.props.title || (typeof cell.props.children === "string" ? cell.props.children : undefined),
                  _sort: sort,
                  _sorting: params,
                  _nowrap: head.props.nowrap,
                }),
          ),
        })
      : (head ?? null);
  let rows = content.filter((element) => element.type === TableRow);
  let sortedItems = (rows.length ? rows.map((row) => row.props.sortItem) : (items as unknown[])).filter(
    (item) => item !== undefined && item !== null,
  );

  if (isSortable && params.sortBy && params.orderBy) {
    sortedItems = getSorted(
      sortedItems,
      (sortable as Record<string, (item: unknown) => unknown>)[params.sortBy],
      params.orderBy,
    );
    if (rows.length)
      rows = sortedItems
        .map((item) => rows.find((row) => row.props.sortItem === item))
        .filter((row): row is React.ReactElement<Passed> => !!row);
  }
  let body: ReactNode = rows;

  if (!rows.length && !(items as unknown[]).length && noItems) body = noItems as ReactNode;
  else if (virtual)
    body = (
      <VirtualRows
        items={sortedItems as { getId(): string }[]}
        className={className as string | undefined}
        getRow={getTableRow as (id: string) => ReactNode}
      />
    );
  return (
    <div
      className={cssNames("Table flex flex-col", className, {
        selectable,
        scrollable,
        sortable: isSortable,
        autoSize,
        virtual,
      })}
    >
      {renderedHead}
      {body}
    </div>
  );
}

// The virtual list the host draws the rows of a list with (packages/core/src/renderer/components/virtual-list/
// virtual-list.tsx lines 130 to 176): a row for each item, each the element the list gave for it, which the
// list draws in an element of its own (item-object-list/content.tsx lines 391 to 406). The host draws the rows a
// room shows, which is every row in its own tests (lines 54 to 60) and in a room that holds them: every row is
// drawn here, with no place computed for it.
function VirtualRows({
  items,
  className,
  getRow,
}: {
  items: { getId(): string }[];
  className?: string;
  getRow: (id: string) => ReactNode;
}) {
  return (
    <div className={cssNames("VirtualList", className)}>
      {/* biome-ignore lint/a11y/useSemanticElements: react-window gives the element of the rows the role of a list */}
      <div className="list" role="list">
        {items.map((item) => getRow(item.getId()))}
      </div>
    </div>
  );
}

// `DrawerItem` (packages/core/src/renderer/components/drawer/drawer-item.tsx lines 28 to 51): its element is given
// what it was passed, and holds its name and its value; an item without a name is marked so.
function DrawerItem({ name, title, labelsOnly, children, hidden = false, className, ...elemProps }: Passed) {
  if (hidden) return null;
  return (
    <div
      {...elemProps}
      className={cssNames("DrawerItem", className, name ? "" : "WithoutName", { labelsOnly })}
      title={title as string | undefined}
    >
      {name ? <span className="name">{name as ReactNode}</span> : null}
      <span className="value">{children}</span>
    </div>
  );
}

// What the details of the host show, read as their markup has it (drawer-item.tsx lines 41 to 49): the value of
// the item of a name, and the names of the items, in their order.
export function drawerValue(name: string, within: ParentNode = document): string | null | undefined {
  return [...within.querySelectorAll(".DrawerItem")]
    .find((item) => item.querySelector(":scope > .name")?.textContent === name)
    ?.querySelector(":scope > .value")?.textContent;
}

export function drawerNames(within: ParentNode): (string | null | undefined)[] {
  return [...within.querySelectorAll(".DrawerItem")].map((item) => item.querySelector(":scope > .name")?.textContent);
}

// `DrawerTitle` (packages/core/src/renderer/components/drawer/drawer-title.tsx lines 30 to 41).
function DrawerTitle({ className, children, size = "title" }: Passed) {
  return (
    <div className={cssNames("DrawerTitle", className, { title: size === "title", "sub-title": size === "sub-title" })}>
      {children}
    </div>
  );
}

// `MaybeLink` (packages/core/src/renderer/components/maybe-link/maybe-link.tsx lines 8 to 19) and the `Link` it draws
// (packages/routing/src/link.tsx lines 63 to 89): with no address, what it holds alone; with one, a link whose
// address is the one of the browser history of the host, and which a plain click of the first button takes the
// history to, preventing what the browser would do.
function MaybeLink({ children, to, onClick, target, replace, ...rest }: Passed) {
  if (!to) return <>{children}</>;
  if (replace) notModeled("MaybeLink", "replacement of the address");
  if (typeof to !== "string") notModeled("MaybeLink", "address given in parts");
  const href = to.startsWith("?") ? `${addressPath()}${to}` : to;

  return (
    <a
      {...rest}
      href={href}
      target={target as string | undefined}
      onClick={(event) => {
        (onClick as Handler | undefined)?.(event as never);
        const modified = event.metaKey || event.altKey || event.ctrlKey || event.shiftKey;

        if (event.defaultPrevented || event.button !== 0 || (target && target !== "_self") || modified) return;
        event.preventDefault();
        pushAddress(to);
      }}
    >
      {children}
    </a>
  );
}

// `Badge` (packages/core/src/renderer/components/badge/badge.tsx lines 36 to 88), inside `withTooltip`: an element
// with its label, which is not expandable while it is not wider than its room, which jsdom gives none of.
const Badge = withTooltip(
  ({ small, flat, label, expandable = true, disabled, scrollable, className, children, ...elemProps }: Passed) => {
    void expandable;
    return (
      <div
        {...elemProps}
        className={cssNames("badge", className, {
          small,
          flat,
          clickable: Boolean(elemProps.onClick),
          disabled,
          scrollable,
        })}
      >
        {label as ReactNode}
        {children}
      </div>
    );
  },
);

// `LocaleDate` (packages/core/src/renderer/components/locale-date/locale-date.tsx lines 22 to 31), with
// `formatInTimeZone` (packages/utility-features/utilities/src/date.ts lines 97 to 114): a date in the zone the
// preferences of the host name, written as `2026-09-01T10:00:00Z`; the zone is UTC here.
function LocaleDate({ date }: { date: string | Date }) {
  return `${new Date(date).toISOString().slice(0, 19)}Z`;
}

// `WithTooltip` (packages/core/src/renderer/components/with-tooltip/with-tooltip.tsx lines 19 to 37): what it holds
// as the label of a flat badge, with a tooltip of a date in words, of what it is given, or of what it holds. It
// draws nothing else it is given but the identifier of the tests.
function WithTooltip(props: Passed) {
  let tooltip: ReactNode;

  if (props.tooltip instanceof Date) tooltip = <LocaleDate date={props.tooltip} />;
  else if (props.tooltip !== undefined) tooltip = props.tooltip as ReactNode;
  else tooltip = props.children ?? "";
  return (
    <Badge
      label={props.children}
      tooltip={tooltip}
      flat={props.flat ?? true}
      expandable={props.expandable ?? true}
      data-testid={props["data-testid"]}
    />
  );
}

// `formatDuration` (packages/utility-features/utilities/src/formatDuration.ts lines 10 to 134).
const DAYS_TO_MONTHS = 4800 / 146097;
const MONTHS_TO_DAYS = 146097 / 4800;
const DAYS_PER_YEAR = 146097 / 400;

function meaningful(values: number[], suffixes: string[], separator = " "): string {
  return values
    .map((value, index): [number, string] => [value, suffixes[index]])
    .filter(([value]) => value > 0)
    .map(([value, suffix]) => `${value}${suffix}`)
    .join(separator);
}

export function formatDuration(timeValue: number, compact = true): string {
  const totalSeconds = Math.floor(timeValue / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);
  const part = {
    seconds: totalSeconds % 60,
    minutes: totalMinutes % 60,
    hours: totalHours % 24,
    days: totalDays - Math.ceil(Math.floor(totalDays * DAYS_TO_MONTHS) * MONTHS_TO_DAYS),
  };
  const separator = compact ? "" : " ";
  const seconds = Math.floor(timeValue / 1000);

  if (seconds < 0) return "0s";
  if (seconds < 60 * 2) return `${seconds}s`;
  const minutes = Math.floor(timeValue / 60000);

  if (minutes < 10) return meaningful([minutes, part.seconds], ["m", "s"], separator);
  if (minutes < 60 * 3) return compact ? `${minutes}m` : meaningful([minutes, part.seconds], ["m", "s"]);
  const hours = Math.floor(timeValue / 3_600_000);

  if (hours < 8) return meaningful([hours, part.minutes], ["h", "m"], separator);
  if (hours < 48) return compact ? `${hours}h` : meaningful([hours, part.minutes], ["h", "m"]);
  const days = Math.floor(timeValue / 86_400_000);

  if (days < 8)
    return compact
      ? meaningful([days, part.hours], ["d", "h"], separator)
      : meaningful([days, part.hours, part.minutes], ["d", "h", "m"]);
  const years = Math.floor(timeValue / 86_400_000 / DAYS_PER_YEAR);

  if (years < 2) return compact ? `${days}d` : meaningful([days, part.hours, part.minutes], ["d", "h", "m"]);
  if (years < 8 && compact) return meaningful([years, part.days], ["y", "d"], separator);
  if (compact) return `${years}y`;
  return meaningful([years, part.days, part.hours, part.minutes], ["y", "d", "h", "m"]);
}

// `KubeObjectAge` (packages/core/src/renderer/components/kube-object/age.tsx lines 25 to 32) and the
// `ReactiveDuration` it draws (duration/reactive-duration.tsx lines 46 to 56): how long ago the object was made,
// in a badge whose tooltip is the time it was made. The host draws it again every second or every minute; the
// double draws it when its list is drawn.
function KubeObjectAge({ object, compact = true, withTooltip: tooltip = true }: Passed) {
  const created = (object as { metadata: { creationTimestamp?: string } }).metadata.creationTimestamp;
  const duration = created ? formatDuration(Date.now() - new Date(created).getTime(), compact as boolean) : "<unknown>";

  return tooltip ? <WithTooltip tooltip={new Date(created ?? Date.now())}>{duration}</WithTooltip> : duration;
}

// The confirmation dialog of the host: `ConfirmDialog.open` sets what the dialog of the frame shows
// (packages/core/src/extensions/renderer-api/components.ts lines 130 to 133, confirm-dialog/open.injectable.ts
// lines 14 to 21), which a test answers by calling what it was given. What it was opened with is recorded, and
// nothing is drawn: the extension draws no `ConfirmDialog` of its own.
export interface ConfirmDialogParams {
  message: ReactNode;
  labelOk?: ReactNode;
  labelCancel?: ReactNode;
  ok?: () => unknown;
  cancel?: () => unknown;
}
export const confirmDialogs: ConfirmDialogParams[] = [];

const ConfirmDialog = Object.assign(
  (_props: Passed): ReactNode => notModeled("ConfirmDialog", "dialog drawn by the extension"),
  {
    open: (params: ConfirmDialogParams) => {
      confirmDialogs.push(params);
    },
  },
);

// `NoItems` (packages/core/src/renderer/components/no-items/no-items.tsx lines 18 to 26).
function NoItems({ className, children }: Passed) {
  return (
    <div className={cssNames("NoItems flex grow shrink-0 basis-0", className)}>
      <div className="m-auto">{children || "Item list is empty"}</div>
    </div>
  );
}

// The parameters of the address the list of the host reads: what is searched (input/search-url-page-param
// .injectable.ts), and the object whose details are shown (kube-detail-params/kube-details-url.injectable.ts and
// kube-selected-url.injectable.ts).
const searchParam = createPageParam({ name: "search", defaultValue: "" });
const detailsParam = createPageParam({ name: "kube-details" });
const selectedParam = createPageParam({
  name: "kube-selected",
  get defaultValue() {
    return detailsParam.get();
  },
});

// The field of the search of a list (input/search-input-url.tsx lines 32 to 262, with search-input.tsx lines 38
// to 102): the `Input` of the host, taking the focus when it is mounted, with the words of the search of the
// address, which it writes there 250 milliseconds after a change, and at once when it is cleared, by Escape or by
// the command next to the words; Ctrl or Cmd with F, in the whole window, gives it the focus. The searches the
// host keeps for each list and namespace, or for every list, which a link next to the field chooses between, are
// not modeled: the link is drawn, and a search is the one of the address.
function SearchInputUrl({ placeholder, ...props }: Passed) {
  const [words, setWords] = React.useState(() => searchParam.get() as string);
  const field = React.useRef<HTMLDivElement>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const write = (value: string, now = false) => {
    clearTimeout(timer.current);
    if (now) searchParam.set(value);
    else timer.current = setTimeout(() => searchParam.set(value), 250);
  };
  const clear = () => {
    setWords("");
    write("", true);
  };

  React.useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "f" && (process.platform === "darwin" ? event.metaKey : event.ctrlKey))
        field.current?.querySelector("input")?.focus();
    };

    window.addEventListener("keydown", key);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("keydown", key);
    };
  }, []);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }} ref={field}>
      <Input
        {...props}
        autoFocus
        placeholder={(placeholder as string | undefined) ?? "Search..."}
        className="SearchInput"
        value={words}
        blurOnEnter={false}
        iconRight={words ? <Icon small material="close" onClick={clear} /> : <Icon small material="search" />}
        onChange={(value: string) => {
          setWords(value);
          write(value);
        }}
        onKeyDown={(event: React.KeyboardEvent) => {
          if (event.nativeEvent.code !== "Escape") return;
          clear();
          event.stopPropagation();
        }}
      />
      <Icon
        small
        material="link_off"
        onClick={() => notModeled("SearchInputUrl", "search kept for every list")}
        tooltip="Link search (shared)"
      />
    </div>
  );
}

// `createSearchMatcher` (packages/core/src/renderer/components/item-object-list/search-matcher.ts lines 25 to 33).
function searchMatcher(search: string): (value: unknown) => boolean {
  const query = search.toLowerCase();

  return (value) => {
    const text = String(value).toLowerCase();

    return text.includes(query) || text.replace(/[-_]/g, "").includes(query);
  };
}

interface Item {
  getId(): string;
  getName(): string;
  selfLink: string;
}

interface ListStore {
  api: { kind: string; isNamespaced?: boolean };
  isLoaded: boolean;
  failedLoading: boolean;
  contextItems: Item[];
  getTotalCount(): number;
  getByPath(path: string): Item | undefined;
  isSelected(item: Item): boolean;
  pickOnlySelected(items: Item[]): Item[];
  removeItems?: unknown;
  removeSelectedItems?: unknown;
}

interface Header {
  title?: ReactNode;
  info?: ReactNode;
  filters?: ReactNode;
  searchProps?: Passed;
}

// The props the lists of the host were last drawn with, by their table.
export const listProps = new Map<string, Record<string, unknown>>();

// The filter of the namespaces the host puts into the head of the list of a kind that is in a namespace
// (namespaces/namespace-select-filter.tsx): it is drawn as an element that says it is there.
function NamespaceSelectFilter({ id }: Passed) {
  return <div className="NamespaceSelectFilter" id={id as string} />;
}

// `KubeObjectListLayout` (packages/core/src/renderer/components/kube-object-list-layout/kube-object-list-layout.tsx
// lines 92 to 297), the `ItemListLayout` it draws (item-object-list/list-layout.tsx lines 150 to 378), its head
// (header.tsx lines 35 to 92) and its content (content.tsx lines 311 to 598), as the extension gives them: a
// store that is no store of the host, rows that only open a view, no box of a choice, no menu of a row.
// - The head: the title, what is counted, the filter of the namespaces the host adds for a kind in a namespace,
//   and the field of the search, each customized by the host first and then by the list (kube-object-list-layout
//   .tsx lines 249 to 272). The host counts the items of the store, and says what a search left of them.
// - The rows: what the list gives for the items the search of the address leaves, each cell with the class of
//   its column, in the order the table keeps; a row is selected while its object is the one of the details,
//   and opens it at a click, which goes no further; the menu of a row is in a cell of its own.
// - No row: a spinner while the store is not loaded, words when nothing is left, or when it failed.
// The getters of the host are read inside its derivations, which the extension's callbacks are called from.
function KubeObjectListLayout(props: Passed) {
  const {
    className,
    customizeHeader,
    store: given,
    items: providedItems,
    dependentStores: _dependentStores,
    onDetails,
    renderTableContents,
    renderTableHeader = [],
    columns,
    sortingCallbacks = {},
    customizeTableRowProps,
    ...layoutProps
  } = props;
  const store = given as ListStore;
  const resourceName = (props.resourceName as string | undefined) || store.api.kind;
  const selectedItem = store.getByPath(selectedParam.get() as string);

  if (columns) notModeled("KubeObjectListLayout", "column of its own");
  // The host subscribes the stores of a list to the cluster unless it is told not to (lines 98 to 139).
  if (props.subscribeStores !== false) notModeled("KubeObjectListLayout", "subscription of its stores");
  const layout: Passed = {
    getItems: () => (providedItems as Item[] | undefined) || store.contextItems,
    preloadStores: false,
    detailsItem: selectedItem,
    customizeHeader: [
      ({ filters, searchProps, info, ...placeholders }: Header): Header => ({
        filters: (
          <>
            {filters}
            {store.api.isNamespaced ? (
              <NamespaceSelectFilter id="kube-object-list-layout-namespace-select-input" />
            ) : null}
          </>
        ),
        searchProps: { ...searchProps, placeholder: `Search ${resourceName}...` },
        info: <>{info}</>,
        ...placeholders,
      }),
      ...[customizeHeader].filter(Boolean).flat(),
    ],
    renderItemMenu: () => notModeled("KubeObjectListLayout", "menu of a row"),
    onDetails: onDetails ?? (() => notModeled("KubeObjectListLayout", "details of the host")),
    sortingCallbacks,
    renderTableHeader,
    renderTableContents,
    spinnerTestId: "kube-object-list-layout-spinner",
    ...layoutProps,
    customizeTableRowProps: (item: Item) => {
      const base = (customizeTableRowProps as ((item: Item) => Passed) | undefined)?.(item) ?? {};

      return {
        id: `menu-actions-for-kube-object-menu-for-${item.getId()}`,
        ...base,
        // No menu of a row was made ready: the host lets the click of the context go on.
        onContextMenu: (event: React.MouseEvent) => (base.onContextMenu as Handler | undefined)?.(event as never),
      };
    },
  };

  listProps.set(props.tableId as string, props);
  return <ItemListLayout {...layout} className={cssNames("KubeObjectListLayout", className)} store={store} />;
}

function ItemListLayout(props: Passed) {
  const {
    tableId,
    className,
    getItems,
    store: given,
    searchFilters = [],
    filterItems = [],
    showHeader = true,
    headerClassName,
    renderHeaderTitle,
    customizeHeader = [],
    isReady,
    isSelectable = true,
    isConfigurable,
    copyClassNameFromHeadCells = true,
    sortingCallbacks,
    tableProps = {},
    renderTableHeader,
    renderTableContents,
    renderItemMenu,
    customizeTableRowProps = () => ({}),
    addRemoveButtons = {},
    virtual = true,
    hasDetailsView = true,
    detailsItem,
    onDetails = () => undefined,
    failedToLoadMessage = "Failed to load items",
    spinnerTestId,
    filterCallbacks,
    "data-testid": testId,
  } = props;
  const store = given as ListStore;
  const search = searchParam.get() as string;
  const searches = searchFilters as ((item: Item) => unknown)[];
  const filters = search && searches.length ? [{ type: "search", value: search }] : [];
  const all = (getItems as () => Item[])();
  const searched = filters.length
    ? all.filter((item) => searches.some((texts) => [texts(item)].flat().some(searchMatcher(search))))
    : all;
  const items = (filterItems as ((items: Item[]) => Item[])[]).reduce((left, filter) => filter(left), searched);
  const ready = (isReady as boolean | undefined) ?? store.isLoaded;
  const header = (renderTableHeader as (Passed | null | undefined)[] | undefined) ?? [];
  const row = (item: Item) => {
    const cells = (renderTableContents as (item: Item) => unknown[])(item);

    return (
      <TableRow
        key={item.getId()}
        nowrap
        searchItem={item}
        sortItem={item}
        selected={detailsItem ? (detailsItem as Item).getId() === item.getId() : undefined}
        onClick={hasDetailsView ? prevDefault(() => (onDetails as (item: Item) => void)(item)) : undefined}
        {...(customizeTableRowProps as (item: Item) => Passed)(item)}
      >
        {isSelectable ? notModeled("KubeObjectListLayout", "box of a choice") : null}
        {cells.map((content, index) => {
          const cellProps: Passed = isReactNode(content)
            ? { children: content as ReactNode }
            : { ...(content as Passed) };
          const head = header[index];

          if (copyClassNameFromHeadCells && head) cellProps.className = cssNames(cellProps.className, head.className);
          return <TableCell key={index} {...cellProps} style={{ ...(cellProps.style as object) }} />;
        })}
        {renderItemMenu ? (
          <TableCell className="menu">
            {/* biome-ignore lint/a11y/noStaticElementInteractions: as the host draws it */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: as the host draws it */}
            <div onClick={stopPropagation}>
              {(renderItemMenu as (item: Item, store: unknown) => ReactNode)(item, store)}
            </div>
          </TableCell>
        ) : null}
      </TableRow>
    );
  };
  const noItems = store.failedLoading ? (
    <NoItems>{failedToLoadMessage as ReactNode}</NoItems>
  ) : !ready ? (
    <Spinner center data-testid={spinnerTestId as string | undefined} />
  ) : filters.length ? (
    <NoItems>
      No items found.
      <p>
        {/* biome-ignore lint/a11y/useValidAnchor: as the host draws it */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: as the host draws it */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: as the host draws it */}
        <a onClick={() => searchParam.clear()} className="contrast">
          Reset filters?
        </a>
      </p>
    </NoItems>
  ) : (
    <NoItems />
  );
  const placeholders = [customizeHeader as ((header: Header) => Header)[]]
    .flat()
    .filter(Boolean)
    .reduce<Header>((before, customizer) => customizer(before), {
      title: (
        <h5 className="title">
          {typeof renderHeaderTitle === "function"
            ? notModeled("KubeObjectListLayout", "title made by a function")
            : (renderHeaderTitle as ReactNode)}
        </h5>
      ),
      info: filters.length ? (
        <>
          {/* biome-ignore lint/a11y/useValidAnchor: as the host draws it */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: as the host draws it */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: as the host draws it */}
          <a onClick={() => notModeled("KubeObjectListLayout", "list of the filters")}>Filtered</a>
          {`: ${items.length} / ${store.getTotalCount()}`}
        </>
      ) : store.getTotalCount() === 1 ? (
        "1 item"
      ) : (
        `${store.getTotalCount()} items`
      ),
      searchProps: {},
    });

  if (isConfigurable || filterCallbacks) notModeled("KubeObjectListLayout", "configuration of its columns");
  void store.pickOnlySelected(items);
  void store.isSelected;
  return (
    <div className={cssNames("ItemListLayout flex flex-col", className)} data-testid={testId}>
      {showHeader ? (
        <div className={cssNames("header flex gap-4 items-center", headerClassName)}>
          {placeholders.title}
          {placeholders.info ? <div className="info-panel grow shrink-0 basis-0">{placeholders.info}</div> : null}
          {placeholders.filters}
          {searches.length > 0 && placeholders.searchProps ? <SearchInputUrl {...placeholders.searchProps} /> : null}
        </div>
      ) : null}
      <div className="items grow shrink-0 basis-0 flex flex-col">
        <Table
          tableId={tableId}
          virtual={virtual}
          selectable={hasDetailsView}
          sortable={sortingCallbacks}
          getTableRow={(id: string) => {
            const item = items.find((one) => one.getId() === id);

            return <div key={id}>{item ? row(item) : null}</div>;
          }}
          renderRow={virtual ? undefined : row}
          items={items}
          noItems={noItems}
          // The type of the theme of the host, the dark one here.
          className={cssNames(className, "grow", "shrink-0", "basis-0", "dark")}
          {...(tableProps as Passed)}
        >
          {renderTableHeader ? (
            <TableHead showTopLine nowrap>
              {header.filter(Boolean).map((cellProps, index) => (
                <TableCell
                  key={((cellProps as Passed).id as string) ?? index}
                  {...(cellProps as Passed)}
                  resizable={(cellProps as Passed).id !== "logs" && !!(cellProps as Passed).id}
                />
              ))}
              <TableCell className="menu" />
            </TableHead>
          ) : null}
        </Table>
        <div className="AddRemoveButtons flex gap-2">
          {(addRemoveButtons as Passed).onAdd ? notModeled("KubeObjectListLayout", "command to add") : null}
        </div>
      </div>
    </div>
  );
}

// The doubles, by the names `Renderer.Component` of the SDK of v2 exports them by: a double of a name it does not
// export does not compile. A name of a component with no double here is refused by the stub.
export const hostComponents = {
  Button,
  ConfirmDialog,
  DrawerItem,
  DrawerTitle,
  Icon,
  Input,
  KubeObjectAge,
  KubeObjectListLayout,
  LocaleDate,
  MaybeLink,
  Select,
  Spinner,
  Tab,
  Table,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  WithTooltip,
} satisfies { [Name in keyof typeof Renderer.Component]?: unknown };
