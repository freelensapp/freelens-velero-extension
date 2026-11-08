import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { NOT_OFFERED, TEMPLATE_FIELD_WORDS } from "../../common/backup-create-words";
import { durationOf } from "../../common/backup-template";
import { escapeOfField } from "./artifact-viewer";
import styles from "./views.module.css";

import type { BackupTemplate, TemplateField, TemplateProblems } from "../../common/backup-template";
import type { HostNamespace } from "../api/host-namespaces";

const {
  Component: { Input, Select },
} = Renderer;

interface Option {
  value: string;
  label: string;
}

// A storage location of the installation, as the form offers it: chosen by its name, the default marked, and the reason
// it cannot be chosen when Velero refuses every backup sent to it (SPEC-0016, REQ-236).
export interface LocationChoice {
  name: string;
  isDefault: boolean;
  refused?: string;
}

// What the form offers for its choices, as the views read them: the storage and the snapshot locations of the
// installation, and the namespaces the host lists.
export interface TemplateChoices {
  locations: LocationChoice[];
  // What the read of the locations is at, in words, while they are not known.
  locationsUnknown?: string;
  snapshotLocations: { name: string; provider: string }[];
  namespaces: HostNamespace[];
}

// What the form edits: the fields, what the release refuses of them, and the change of one.
export interface TemplateState {
  template: BackupTemplate;
  problems: TemplateProblems;
  set<Field extends TemplateField>(field: Field, value: BackupTemplate[Field] | undefined): void;
}

const BOOLEAN_CHOICES: Option[] = [
  { value: "true", label: "True" },
  { value: "false", label: "False" },
];
const NOT_SET = "Not set";

// The items of a list as they are typed: separated by commas, each without the spaces around it.
function itemsOf(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

// The words of a field: what Velero does when it is not set, and what is wrong with it, each tied to the field by its
// identifier.
function FieldNotes({ id, field, problems }: { id: string; field: TemplateField; problems?: string[] }) {
  return (
    <>
      <p id={`${id}-not-set`} className={styles.factNote}>
        Not set: {TEMPLATE_FIELD_WORDS[field].notSet}
      </p>
      {problems?.length ? (
        <ul id={`${id}-problem`} className={styles.formError} data-testid={`${id}-problem`}>
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function describedBy(id: string, problems?: string[]): string {
  return `${id}-not-set${problems?.length ? ` ${id}-problem` : ""}`;
}

// A text field of the items of a list. What is typed stays as it is typed while it reads as the items of the field; a
// change from elsewhere, a choice of the host or a form that was emptied, writes the items again.
function ItemsField({
  id,
  label,
  items,
  disabled,
  problems,
  onItems,
}: {
  id: string;
  label: string;
  items: string[];
  disabled: boolean;
  problems?: string[];
  onItems(items: string[]): void;
}) {
  const [text, setText] = React.useState(items.join(", "));

  if (itemsOf(text).join(",") !== items.join(",")) setText(items.join(", "));
  return (
    <>
      <span id={`${id}-label`} className={styles.factName}>
        {label}
      </span>
      {/* Escape in the field takes back what was typed in it, and goes no further. */}
      <Input
        theme="round-black"
        aria-labelledby={`${id}-label`}
        aria-describedby={describedBy(id, problems)}
        aria-invalid={problems?.length ? true : undefined}
        data-testid={id}
        value={text}
        disabled={disabled}
        onChange={(next) => {
          setText(next);
          onItems(itemsOf(next));
        }}
        onKeyDown={(event) => {
          escapeOfField(event, () => {
            setText("");
            onItems([]);
          });
        }}
      />
    </>
  );
}

// The namespaces of a list: the ones the host lists, each a checkbox, and the patterns and the names it does not list,
// typed. The list is both.
const NamespacesField = observer(
  ({
    state,
    field,
    id,
    namespaces,
    disabled,
  }: {
    state: TemplateState;
    field: "includedNamespaces" | "excludedNamespaces";
    id: string;
    namespaces: HostNamespace[];
    disabled: boolean;
  }) => {
    const items = state.template[field] ?? [];
    const listed = new Set(namespaces.map((namespace) => namespace.name));
    const typed = items.filter((item) => !listed.has(item));
    const problems = state.problems[field];
    const write = (next: string[]) => state.set(field, [...new Set(next)]);

    return (
      <fieldset className={styles.templateField} data-testid={id} aria-describedby={describedBy(id, problems)}>
        <legend className={styles.factName}>{TEMPLATE_FIELD_WORDS[field].label}</legend>
        {namespaces.length ? (
          <ul
            className={styles.templateChoices}
            aria-label={`The namespaces the host lists, ${field === "includedNamespaces" ? "to include" : "to exclude"}`}
          >
            {namespaces.map((namespace) => (
              <li key={namespace.name}>
                <label className={styles.templateChoice}>
                  <input
                    type="checkbox"
                    data-testid={`${id}-${namespace.name}`}
                    checked={items.includes(namespace.name)}
                    disabled={disabled}
                    onChange={(event) =>
                      write(
                        event.target.checked
                          ? [...items, namespace.name]
                          : items.filter((item) => item !== namespace.name),
                      )
                    }
                  />
                  {namespace.name}
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.factNote}>The host lists no namespace for this cluster yet: the names are typed.</p>
        )}
        <ItemsField
          id={`${id}-typed`}
          label="Patterns, and names the host does not list, separated by commas"
          items={typed}
          disabled={disabled}
          onItems={(next) => write([...items.filter((item) => listed.has(item)), ...next])}
        />
        <FieldNotes id={id} field={field} problems={problems} />
      </fieldset>
    );
  },
);

// A field that is not set, true or false.
const BooleanField = observer(
  ({ state, field, id, disabled }: { state: TemplateState; field: TemplateField; id: string; disabled: boolean }) => {
    const value = state.template[field];
    const problems = state.problems[field];

    return (
      <div className={styles.templateField}>
        <label className={styles.factName} htmlFor={id}>
          {TEMPLATE_FIELD_WORDS[field].label}
        </label>
        <Select<string, Option, false>
          id={id}
          inputId={id}
          themeName="lens"
          aria-describedby={describedBy(id, problems)}
          placeholder={NOT_SET}
          isClearable
          isDisabled={disabled}
          options={BOOLEAN_CHOICES}
          value={value === undefined ? null : String(value)}
          onChange={(option) =>
            state.set(field, (option ? option.value === "true" : undefined) as BackupTemplate[typeof field])
          }
        />
        <FieldNotes id={id} field={field} problems={problems} />
      </div>
    );
  },
);

// A duration, as Go reads it: what the form writes is said beside it.
const DurationField = observer(
  ({
    state,
    field,
    id,
    disabled,
  }: {
    state: TemplateState;
    field: "ttl" | "csiSnapshotTimeout" | "itemOperationTimeout";
    id: string;
    disabled: boolean;
  }) => {
    const value = state.template[field] ?? "";
    const problems = state.problems[field];
    const read = value ? durationOf(value) : undefined;

    return (
      <div className={styles.templateField}>
        <span id={`${id}-label`} className={styles.factName}>
          {TEMPLATE_FIELD_WORDS[field].label}
        </span>
        <Input
          theme="round-black"
          aria-labelledby={`${id}-label`}
          aria-describedby={describedBy(id, problems)}
          aria-invalid={problems?.length ? true : undefined}
          data-testid={id}
          value={value}
          disabled={disabled}
          onChange={(next) => state.set(field, next.trim() === "" ? undefined : next.trim())}
          onKeyDown={(event) => {
            escapeOfField(event, () => state.set(field, undefined));
          }}
        />
        {read && "written" in read ? (
          <p className={styles.factNote} data-testid={`${id}-written`}>
            Written as {read.written}.
          </p>
        ) : null}
        <FieldNotes id={id} field={field} problems={problems} />
      </div>
    );
  },
);

type SelectorMode = "none" | "one" | "several";

// The selectors: none, one, or any of several, separated by " or " as the command line of the release takes them.
const SelectorField = observer(({ state, id, disabled }: { state: TemplateState; id: string; disabled: boolean }) => {
  const one = state.template.labelSelector;
  const several = state.template.orLabelSelectors;
  const mode: SelectorMode = one !== undefined ? "one" : several !== undefined ? "several" : "none";
  const problems = [...(state.problems.labelSelector ?? []), ...(state.problems.orLabelSelectors ?? [])];
  const text = mode === "one" ? (one ?? "") : mode === "several" ? (several ?? []).join(" or ") : "";
  const write = (next: SelectorMode, words: string) => {
    const selectors = words
      .split(" or ")
      .map((selector) => selector.trim())
      .filter((selector) => selector !== "");

    state.set("labelSelector", next === "one" && words.trim() !== "" ? words.trim() : undefined);
    state.set("orLabelSelectors", next === "several" && selectors.length > 0 ? selectors : undefined);
  };
  const [chosen, setChosen] = React.useState<SelectorMode>(mode);
  const shown: SelectorMode = mode === "none" ? chosen : mode;

  return (
    <div className={styles.templateField}>
      <label className={styles.factName} htmlFor={`${id}-mode`}>
        Label selector, or any of several
      </label>
      <Select<string, Option, false>
        id={`${id}-mode`}
        inputId={`${id}-mode`}
        themeName="lens"
        placeholder="No filter"
        isDisabled={disabled}
        options={[
          { value: "one", label: "One selector" },
          { value: "several", label: "Any of several selectors, separated by or" },
        ]}
        value={shown === "none" ? null : shown}
        onChange={(option) => {
          const next = (option?.value ?? "none") as SelectorMode;

          setChosen(next);
          write(next, text);
        }}
      />
      {shown === "none" ? null : (
        <>
          <span id={`${id}-label`} className={styles.factName}>
            {shown === "one" ? TEMPLATE_FIELD_WORDS.labelSelector.label : TEMPLATE_FIELD_WORDS.orLabelSelectors.label}
          </span>
          <Input
            theme="round-black"
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-rule${problems.length ? ` ${id}-problem` : ""}`}
            aria-invalid={problems.length ? true : undefined}
            data-testid={id}
            value={text}
            disabled={disabled}
            onChange={(next) => write(shown, next)}
            onKeyDown={(event) => {
              escapeOfField(event, () => write(shown, ""));
            }}
          />
          <p id={`${id}-rule`} className={styles.factNote}>
            In the selector syntax of Kubernetes: key=value, key!=value, key in (a,b), key notin (a,b), key and !key,
            separated by commas{shown === "several" ? "; the selectors separated by or" : ""}.
          </p>
        </>
      )}
      {problems.length ? (
        <ul id={`${id}-problem`} className={styles.formError} data-testid={`${id}-problem`}>
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});

// The storage location, among the ones of the installation, always written: the default first when it can be chosen,
// and the ones Velero refuses every backup for shown with the reason, which cannot be chosen.
const StorageLocationField = observer(
  ({
    state,
    id,
    choices,
    disabled,
  }: {
    state: TemplateState;
    id: string;
    choices: TemplateChoices;
    disabled: boolean;
  }) => {
    const problems = state.problems.storageLocation;
    const offered = choices.locations.filter((location) => !location.refused);
    const refused = choices.locations.filter((location) => location.refused);
    const options = offered.map((location) => ({
      value: location.name,
      label: location.isDefault ? `${location.name}, marked default` : location.name,
    }));

    return (
      <div className={styles.templateField}>
        <label className={styles.factName} htmlFor={id}>
          {TEMPLATE_FIELD_WORDS.storageLocation.label}
        </label>
        <Select<string, Option, false>
          id={id}
          inputId={id}
          themeName="lens"
          aria-describedby={`${id}-refused${problems?.length ? ` ${id}-problem` : ""}`}
          placeholder={options.length ? "Choose a location" : "None to choose"}
          isDisabled={disabled || options.length === 0}
          options={options}
          value={state.template.storageLocation ?? null}
          onChange={(option) => state.set("storageLocation", option?.value)}
        />
        <div id={`${id}-refused`}>
          {choices.locationsUnknown ? (
            <p className={styles.factNote} data-testid={`${id}-unknown`}>
              {choices.locationsUnknown}
            </p>
          ) : null}
          {refused.map((location) => (
            <p key={location.name} className={styles.factNote} data-testid={`${id}-refused-${location.name}`}>
              {location.refused}
            </p>
          ))}
        </div>
        {problems?.length ? (
          <ul id={`${id}-problem`} className={styles.formError} data-testid={`${id}-problem`}>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  },
);

// The snapshot locations: for each provider of the installation, one of its locations, or none, for the default of the
// server.
const SnapshotLocationsField = observer(
  ({
    state,
    id,
    choices,
    disabled,
  }: {
    state: TemplateState;
    id: string;
    choices: TemplateChoices;
    disabled: boolean;
  }) => {
    const chosen = state.template.volumeSnapshotLocations ?? [];
    const providers = [...new Set(choices.snapshotLocations.map((location) => location.provider))].sort();
    const problems = state.problems.volumeSnapshotLocations;

    return (
      <fieldset className={styles.templateField} data-testid={id} aria-describedby={describedBy(id, problems)}>
        <legend className={styles.factName}>{TEMPLATE_FIELD_WORDS.volumeSnapshotLocations.label}</legend>
        {providers.length === 0 ? <p className={styles.factNote}>The installation has no snapshot location.</p> : null}
        {providers.map((provider) => {
          const ofProvider = choices.snapshotLocations.filter((location) => location.provider === provider);
          const current = ofProvider.find((location) => chosen.includes(location.name));

          return (
            <div key={provider} className={styles.templateField}>
              <label className={styles.factNote} htmlFor={`${id}-${provider}`}>
                {provider}
              </label>
              <Select<string, Option, false>
                id={`${id}-${provider}`}
                inputId={`${id}-${provider}`}
                themeName="lens"
                placeholder={NOT_SET}
                isClearable
                isDisabled={disabled}
                options={ofProvider.map((location) => ({ value: location.name, label: location.name }))}
                value={current?.name ?? null}
                onChange={(option) => {
                  const others = chosen.filter((name) => !ofProvider.some((location) => location.name === name));

                  state.set("volumeSnapshotLocations", option ? [...others, option.value] : others);
                }}
              />
            </div>
          );
        })}
        <FieldNotes id={id} field="volumeSnapshotLocations" problems={problems} />
      </fieldset>
    );
  },
);

export interface BackupTemplateFormProps {
  state: TemplateState;
  choices: TemplateChoices;
  disabled: boolean;
  // The prefix of the identifiers of the fields, the workspace that holds the form.
  id: string;
}

// The form of the template of a backup (SPEC-0016, the form; SPEC-0017, REQ-260), which the creation of a backup and
// the creation of a schedule share: each field with its label, what Velero does when it is not set and what is wrong
// with it, tied to it; and under it what this version does not offer.
export const BackupTemplateForm = observer(({ state, choices, disabled, id }: BackupTemplateFormProps) => {
  const field = (name: TemplateField) => `${id}-${name}`;

  return (
    <div className={styles.templateForm} data-testid={`${id}-template`}>
      <NamespacesField
        state={state}
        field="includedNamespaces"
        id={field("includedNamespaces")}
        namespaces={choices.namespaces}
        disabled={disabled}
      />
      <NamespacesField
        state={state}
        field="excludedNamespaces"
        id={field("excludedNamespaces")}
        namespaces={choices.namespaces}
        disabled={disabled}
      />
      {(["includedResources", "excludedResources"] as const).map((name) => (
        <div key={name} className={styles.templateField}>
          <ItemsField
            id={field(name)}
            label={`${TEMPLATE_FIELD_WORDS[name].label}, separated by commas`}
            items={state.template[name] ?? []}
            disabled={disabled}
            problems={state.problems[name]}
            onItems={(items) => state.set(name, items)}
          />
          <FieldNotes id={field(name)} field={name} problems={state.problems[name]} />
        </div>
      ))}
      <BooleanField
        state={state}
        field="includeClusterResources"
        id={field("includeClusterResources")}
        disabled={disabled}
      />
      <SelectorField state={state} id={field("labelSelector")} disabled={disabled} />
      <StorageLocationField state={state} id={field("storageLocation")} choices={choices} disabled={disabled} />
      <SnapshotLocationsField
        state={state}
        id={field("volumeSnapshotLocations")}
        choices={choices}
        disabled={disabled}
      />
      {(["snapshotVolumes", "defaultVolumesToFsBackup", "snapshotMoveData"] as const).map((name) => (
        <BooleanField key={name} state={state} field={name} id={field(name)} disabled={disabled} />
      ))}
      {(["ttl", "csiSnapshotTimeout", "itemOperationTimeout"] as const).map((name) => (
        <DurationField key={name} state={state} field={name} id={field(name)} disabled={disabled} />
      ))}
      <p className={styles.factNote} data-testid={`${id}-not-offered`}>
        {NOT_OFFERED}
      </p>
    </div>
  );
});
