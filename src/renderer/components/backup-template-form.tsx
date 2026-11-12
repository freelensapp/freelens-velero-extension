import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { NOT_OFFERED, NOT_OFFERED_OF_A_SCHEDULE, TEMPLATE_FIELD_WORDS } from "../../common/backup-create-words";
import { durationOf, TEMPLATE_WORDS } from "../../common/backup-template";
import { escapeOfField } from "./artifact-viewer";
import styles from "./views.module.css";

import type { BackupTemplate, TemplateField, TemplateOf, TemplateProblems } from "../../common/backup-template";
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
  snapshotLocations: { name: string; provider: string }[];
  // What the read of the snapshot locations is at, in words, while they are not known: unknown, not absent.
  snapshotLocationsUnknown?: string;
  namespaces: HostNamespace[];
  // What holds the review back at a field, of what the cluster holds, beside what the release refuses of the field:
  // said at the field, tied to it.
  blockers?: Partial<Record<TemplateField, string[]>>;
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
// change from elsewhere, a form started anew or emptied, writes the items again. The notes it is described by are the
// ones of its field. The form of a restore takes it as well.
export function ItemsField({
  id,
  label,
  items,
  disabled,
  describedBy: notes,
  invalid,
  onItems,
  onSubmit,
}: {
  id: string;
  label: string;
  items: string[];
  disabled: boolean;
  describedBy: string;
  invalid: boolean;
  onItems(items: string[]): void;
  onSubmit?(): void;
}) {
  const [text, setText] = React.useState(items.join(", "));

  if (itemsOf(text).join(",") !== items.join(",")) setText(items.join(", "));
  return (
    <>
      <span id={`${id}-label`} className={styles.factName}>
        {label}
      </span>
      {/* Escape in the field takes back what was typed in it, and goes no further; Enter asks for the review. */}
      <Input
        theme="round-black"
        aria-labelledby={`${id}-label`}
        aria-describedby={notes}
        aria-invalid={invalid ? true : undefined}
        data-testid={id}
        value={text}
        disabled={disabled}
        blurOnEnter={false}
        onSubmit={() => onSubmit?.()}
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

// What the operator chose of a list of namespaces by a checkbox, and what was typed, kept apart while the field is
// edited: a name the host lists, typed as the beginning of a pattern, is not taken for its checkbox.
export interface NamespaceParts {
  checked: string[];
  typed: string[];
}

export function partsOf(items: string[], listed: Set<string>): NamespaceParts {
  return { checked: items.filter((item) => listed.has(item)), typed: items.filter((item) => !listed.has(item)) };
}

export function mergedOf(parts: NamespaceParts): string[] {
  return [...new Set([...parts.checked, ...parts.typed])];
}

export function sameItems(one: string[], other: string[]): boolean {
  return [...new Set(one)].sort().join(",") === [...new Set(other)].sort().join(",");
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
    blockers,
    onSubmit,
  }: {
    state: TemplateState;
    field: "includedNamespaces" | "excludedNamespaces";
    id: string;
    namespaces: HostNamespace[];
    disabled: boolean;
    blockers?: string[];
    onSubmit?(): void;
  }) => {
    const items = state.template[field] ?? [];
    const listed = new Set(namespaces.map((namespace) => namespace.name));
    const [parts, setParts] = React.useState<NamespaceParts>(() => partsOf(items, listed));
    const problems = [...(state.problems[field] ?? []), ...(blockers ?? [])];
    const notes = describedBy(id, problems);

    // A change of the template from elsewhere, a form started anew or emptied, is taken as it is.
    if (!sameItems(mergedOf(parts), items)) setParts(partsOf(items, listed));
    const write = (next: NamespaceParts) => {
      setParts(next);
      state.set(field, mergedOf(next));
    };

    return (
      <fieldset className={styles.templateField} data-testid={id} aria-describedby={notes}>
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
                          ? { checked: [...parts.checked, namespace.name], typed: parts.typed }
                          : {
                              checked: parts.checked.filter((item) => item !== namespace.name),
                              typed: parts.typed.filter((item) => item !== namespace.name),
                            },
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
          items={parts.typed}
          disabled={disabled}
          describedBy={notes}
          invalid={problems.length > 0}
          onItems={(next) => write({ checked: parts.checked, typed: next })}
          onSubmit={onSubmit}
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

    // The select of the host gives the field the notes of its own: the group around it carries the ones of the field.
    return (
      <fieldset
        className={styles.templateField}
        aria-describedby={describedBy(id, problems)}
        data-testid={`${id}-group`}
      >
        <legend id={`${id}-label`} className={styles.factName}>
          {TEMPLATE_FIELD_WORDS[field].label}
        </legend>
        <Select<string, Option, false>
          id={id}
          inputId={id}
          themeName="lens"
          aria-labelledby={`${id}-label`}
          aria-invalid={problems?.length ? true : undefined}
          aria-errormessage={problems?.length ? `${id}-problem` : undefined}
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
      </fieldset>
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
    onSubmit,
  }: {
    state: TemplateState;
    field: "ttl" | "csiSnapshotTimeout" | "itemOperationTimeout";
    id: string;
    disabled: boolean;
    onSubmit?(): void;
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
          blurOnEnter={false}
          onSubmit={() => onSubmit?.()}
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

// What a selector typed writes: one selector as it is typed, without the spaces around it; several, separated by
// " or " as the command line of the release takes them, each without the spaces around it.
function selectorsOf(mode: SelectorMode, words: string): { one?: string; several?: string[] } {
  if (mode === "one") return words.trim() === "" ? {} : { one: words.trim() };
  if (mode !== "several") return {};
  const selectors = words
    .split(" or ")
    .map((selector) => selector.trim())
    .filter((selector) => selector !== "");

  return selectors.length > 0 ? { several: selectors } : {};
}

// The selectors: none, one, or any of several. What is typed stays as it is typed while it reads as the selectors of
// the template, a space at its end among it; a change from elsewhere, a form started anew or emptied, writes it again.
// The form of a restore takes it, with its own fields in the place of the template.
export const SelectorField = observer(
  ({ state, id, disabled, onSubmit }: { state: TemplateState; id: string; disabled: boolean; onSubmit?(): void }) => {
    const one = state.template.labelSelector;
    const several = state.template.orLabelSelectors;
    const mode: SelectorMode = one !== undefined ? "one" : several !== undefined ? "several" : "none";
    const problems = [...(state.problems.labelSelector ?? []), ...(state.problems.orLabelSelectors ?? [])];
    const written = mode === "one" ? (one ?? "") : mode === "several" ? (several ?? []).join(" or ") : "";
    const [chosen, setChosen] = React.useState<SelectorMode>(mode);
    const [text, setText] = React.useState(written);
    const shown: SelectorMode = mode === "none" ? chosen : mode;
    const read = selectorsOf(shown, text);

    if (read.one !== one || JSON.stringify(read.several) !== JSON.stringify(several)) setText(written);
    const write = (next: SelectorMode, words: string) => {
      const selectors = selectorsOf(next, words);

      setText(words);
      state.set("labelSelector", selectors.one);
      state.set("orLabelSelectors", selectors.several);
    };

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
            write(next, next === "none" ? "" : text);
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
              blurOnEnter={false}
              onSubmit={() => onSubmit?.()}
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
  },
);

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
    const blockers = choices.blockers?.storageLocation ?? [];
    // What holds the choice back says why none is chosen: the words that one is asked for go with it.
    const problems = [
      ...blockers,
      ...(state.problems.storageLocation ?? []).filter(
        (problem) => !blockers.length || problem !== TEMPLATE_WORDS.noStorageLocation,
      ),
    ];
    const offered = choices.locations.filter((location) => !location.refused);
    const refused = choices.locations.filter((location) => location.refused);
    const options = offered.map((location) => ({
      value: location.name,
      label: location.isDefault ? `${location.name}, marked default` : location.name,
    }));

    // The select of the host gives the field the notes of its own: the group around it carries the ones of the field.
    return (
      <fieldset
        className={styles.templateField}
        aria-describedby={`${id}-refused${problems.length ? ` ${id}-problem` : ""}`}
        data-testid={`${id}-group`}
      >
        <legend id={`${id}-label`} className={styles.factName}>
          {TEMPLATE_FIELD_WORDS.storageLocation.label}
        </legend>
        <Select<string, Option, false>
          id={id}
          inputId={id}
          themeName="lens"
          aria-labelledby={`${id}-label`}
          aria-invalid={problems.length ? true : undefined}
          aria-errormessage={problems.length ? `${id}-problem` : undefined}
          placeholder={options.length ? "Choose a location" : "None to choose"}
          isDisabled={disabled || options.length === 0}
          options={options}
          value={state.template.storageLocation ?? null}
          onChange={(option) => state.set("storageLocation", option?.value)}
        />
        <div id={`${id}-refused`}>
          {refused.map((location) => (
            <p key={location.name} className={styles.factNote} data-testid={`${id}-refused-${location.name}`}>
              {location.refused}
            </p>
          ))}
        </div>
        {problems.length ? (
          <ul id={`${id}-problem`} className={styles.formError} data-testid={`${id}-problem`}>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}
      </fieldset>
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
        {choices.snapshotLocationsUnknown ? (
          <p className={styles.factNote} data-testid={`${id}-unknown`}>
            {choices.snapshotLocationsUnknown}
          </p>
        ) : providers.length === 0 ? (
          <p className={styles.factNote}>The installation has no snapshot location.</p>
        ) : null}
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
  // What Enter in a field that is typed asks: the review, as Enter in the name does.
  onSubmit?(): void;
  // What the template is of, which what the form does not offer names.
  of?: TemplateOf;
}

// The form of the template of a backup (SPEC-0016, the form; SPEC-0017, REQ-260), which the creation of a backup and
// the creation of a schedule share: each field with its label, what Velero does when it is not set and what is wrong
// with it, tied to it; and under it what this version does not offer.
export const BackupTemplateForm = observer(
  ({ state, choices, disabled, id, onSubmit, of = "backup" }: BackupTemplateFormProps) => {
    const field = (name: TemplateField) => `${id}-${name}`;

    return (
      <div className={styles.templateForm} data-testid={`${id}-template`}>
        {(["includedNamespaces", "excludedNamespaces"] as const).map((name) => (
          <NamespacesField
            key={name}
            state={state}
            field={name}
            id={field(name)}
            namespaces={choices.namespaces}
            disabled={disabled}
            blockers={choices.blockers?.[name]}
            onSubmit={onSubmit}
          />
        ))}
        {(["includedResources", "excludedResources"] as const).map((name) => (
          <div key={name} className={styles.templateField}>
            <ItemsField
              id={field(name)}
              label={`${TEMPLATE_FIELD_WORDS[name].label}, separated by commas`}
              items={state.template[name] ?? []}
              disabled={disabled}
              describedBy={describedBy(field(name), state.problems[name])}
              invalid={Boolean(state.problems[name]?.length)}
              onItems={(items) => state.set(name, items)}
              onSubmit={onSubmit}
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
        <SelectorField state={state} id={field("labelSelector")} disabled={disabled} onSubmit={onSubmit} />
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
          <DurationField
            key={name}
            state={state}
            field={name}
            id={field(name)}
            disabled={disabled}
            onSubmit={onSubmit}
          />
        ))}
        <p className={styles.factNote} data-testid={`${id}-not-offered`}>
          {of === "schedule" ? NOT_OFFERED_OF_A_SCHEDULE : NOT_OFFERED}
        </p>
      </div>
    );
  },
);
