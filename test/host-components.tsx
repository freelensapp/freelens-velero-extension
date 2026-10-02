// What stands for the components of the host in the tests of the views: the markup a test can read and
// act on, and a record of what each list was given. Nothing of the host is drawn: what is under test is
// what the extension gives to the host, and what it shows around it.

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

function Input({ value, onChange, theme: _theme, ...rest }: Passed) {
  return (
    <input
      value={value as string}
      onChange={(event) => (onChange as (next: string) => void)(event.target.value)}
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

function Spinner() {
  return <div className="Spinner" role="progressbar" aria-label="Loading" />;
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
};
