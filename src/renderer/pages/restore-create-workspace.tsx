import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { BACKUP_CREATE_VIEW_WORDS } from "../../common/backup-create-words";
import { restoreBackupOf, scheduleCandidates } from "../../common/restore-candidates";
import {
  backupOffered,
  NOT_OFFERED_OF_A_RESTORE,
  RESTORE_CREATE_VIEW_WORDS,
  RESTORE_FIELD_WORDS,
  restoreCreateMeaning,
  restoreResultWords,
} from "../../common/restore-create-words";
import { readRestoreBody, restoreProblems } from "../../common/restore-form";
import { hostNamespaces, hostNamespacesKnown } from "../api/host-namespaces";
import { escapeOfField } from "../components/artifact-viewer";
import {
  ItemsField,
  mergedOf,
  type NamespaceParts,
  partsOf,
  SelectorField,
  sameItems,
} from "../components/backup-template-form";
import styles from "../components/views.module.css";
import { focusFirst } from "../components/views-frame";
import { Fact, ReviewText, ViewLink, Workspace } from "../components/workspace";
import { openViewAt, replaceView } from "../navigation";

import type { BackupTemplate, TemplateField, TemplateProblems } from "../../common/backup-template";
import type { ClusterResources, ExistingResourcePolicy } from "../../common/restore-form";
import type { BackupResource, RestoreResource } from "../../common/types";
import type { Installation } from "../state/installation";
import type { RestoreCreate, RestoreFrom } from "../state/restore-create";

const {
  Component: { Button, Icon, Input },
} = Renderer;

const ID = "velero-restore-create";

// The backups of a schedule a form lists to choose from, the newest first: an older one is restored from its own view.
export const OFFERED_BOUND = 24;

export interface RestoreCreateWorkspaceProps {
  installation: Installation;
  from: RestoreFrom;
  back: string;
  onBack: () => void;
}

// The names a list of namespaces offers: the ones the spec of the backup names, not its patterns.
function offeredNames(names: readonly string[] | undefined): string[] {
  return [...new Set((names ?? []).filter((name) => !/[*?[\]]/.test(name)))].sort();
}

// A list of namespaces of the backup: the ones its spec names, each a checkbox, and the others typed, matched by Velero
// in the backup. The list is both.
const NamesField = observer(
  ({
    id,
    label,
    notSet,
    offered,
    items,
    problems,
    disabled,
    onItems,
    onSubmit,
  }: {
    id: string;
    label: string;
    notSet: string;
    offered: string[];
    items: string[];
    problems?: string[];
    disabled: boolean;
    onItems(items: string[]): void;
    onSubmit(): void;
  }) => {
    const listed = new Set(offered);
    const [parts, setParts] = React.useState<NamespaceParts>(() => partsOf(items, listed));
    const notes = `${id}-not-set${problems?.length ? ` ${id}-problem` : ""}`;

    // What is typed stays as it is typed, a name the backup names among it, until the list changes from elsewhere: a
    // form started anew or emptied is taken as it is.
    if (!sameItems(mergedOf(parts), items)) setParts(partsOf(items, listed));
    const write = (next: NamespaceParts) => {
      setParts(next);
      onItems(mergedOf(next));
    };

    return (
      <fieldset className={styles.templateField} data-testid={id} aria-describedby={notes}>
        <legend className={styles.factName}>{label}</legend>
        {offered.length ? (
          <ul className={styles.templateChoices} aria-label={`The namespaces the backup names, ${label.toLowerCase()}`}>
            {offered.map((name) => (
              <li key={name}>
                <label className={styles.templateChoice}>
                  <input
                    type="checkbox"
                    data-testid={`${id}-${name}`}
                    checked={items.includes(name)}
                    disabled={disabled}
                    onChange={(event) =>
                      write(
                        event.target.checked
                          ? { checked: [...parts.checked, name], typed: parts.typed }
                          : {
                              checked: parts.checked.filter((item) => item !== name),
                              typed: parts.typed.filter((item) => item !== name),
                            },
                      )
                    }
                  />
                  {name}
                </label>
              </li>
            ))}
          </ul>
        ) : null}
        <ItemsField
          id={`${id}-typed`}
          label={offered.length ? "Others, typed, separated by commas" : "Typed, separated by commas"}
          items={parts.typed}
          disabled={disabled}
          describedBy={notes}
          invalid={Boolean(problems?.length)}
          onItems={(next) => write({ checked: parts.checked, typed: next })}
          onSubmit={onSubmit}
        />
        <p id={`${id}-not-set`} className={styles.factNote}>
          Not set: {notSet}
        </p>
        {problems?.length ? (
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

// The mapping of the namespaces: pairs of a namespace of the backup and the namespace it is restored into, the ones the
// spec of the backup names offered as sources and the ones the host lists as targets, and a new name typed. Each field
// of a pair is named by its place, tied to the problems of the mapping and marked when its pair has one; Escape in it
// takes back what was typed; the focus goes to the pair added, and after a removal to the pair that took its place.
const MappingField = observer(
  ({
    state,
    offered,
    listed,
    disabled,
  }: {
    state: RestoreCreate;
    offered: string[];
    listed: string[] | undefined;
    disabled: boolean;
  }) => {
    const pairs = state.form.namespaceMapping ?? [];
    const problems = state.problems.namespaceMapping;
    const id = `${ID}-namespaceMapping`;
    const holder = React.useRef<HTMLFieldSetElement>(null);
    const [focus, setFocus] = React.useState<string | undefined>(undefined);
    const write = (next: [string, string][]) => state.set("namespaceMapping", next);
    const notes = `${id}-not-set${problems?.length ? ` ${id}-problem` : ""}`;
    // A pair is marked when it is refused alone, or names a source or a target another pair names.
    const wrong = (at: number) => {
      const [source, target] = pairs[at];
      const alone = restoreProblems(
        { ...state.form, namespaceMapping: [[source, target]] },
        state.backup?.namespaces ?? {},
      );
      const twice = pairs.some(
        ([other, into], index) => index !== at && ((source && other === source) || (target && into === target)),
      );

      return Boolean(alone.problems.namespaceMapping?.length) || twice;
    };

    React.useEffect(() => {
      if (!focus) return;
      holder.current?.querySelector<HTMLElement>(focus)?.focus();
      setFocus(undefined);
    }, [focus]);

    return (
      <fieldset ref={holder} className={styles.templateField} data-testid={id} aria-describedby={notes}>
        <legend className={styles.factName}>{RESTORE_FIELD_WORDS.namespaceMapping.label}</legend>
        <datalist id={`${id}-sources`}>
          {offered.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <datalist id={`${id}-targets`}>
          {(listed ?? []).map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        {pairs.map(([source, target], at) => (
          <div key={at} className={styles.mappingPair} data-testid={`${id}-pair-${at}`}>
            <label className={styles.factName} htmlFor={`${id}-source-${at}`}>
              {RESTORE_CREATE_VIEW_WORDS.mappingSource}
            </label>
            <input
              id={`${id}-source-${at}`}
              className={styles.mappingInput}
              list={`${id}-sources`}
              data-testid={`${id}-source-${at}`}
              aria-label={RESTORE_CREATE_VIEW_WORDS.mappingSourceOf(at + 1, pairs.length)}
              aria-describedby={notes}
              aria-invalid={wrong(at) ? true : undefined}
              value={source}
              disabled={disabled}
              onChange={(event) =>
                write(pairs.map((pair, other) => (other === at ? [event.target.value.trim(), pair[1]] : pair)))
              }
              onKeyDown={(event) => {
                escapeOfField(event, () => write(pairs.map((pair, other) => (other === at ? ["", pair[1]] : pair))));
              }}
            />
            <label className={styles.factName} htmlFor={`${id}-target-${at}`}>
              {RESTORE_CREATE_VIEW_WORDS.mappingTarget}
            </label>
            <input
              id={`${id}-target-${at}`}
              className={styles.mappingInput}
              list={`${id}-targets`}
              data-testid={`${id}-target-${at}`}
              aria-label={RESTORE_CREATE_VIEW_WORDS.mappingTargetOf(at + 1, pairs.length)}
              aria-describedby={notes}
              aria-invalid={wrong(at) ? true : undefined}
              value={target}
              disabled={disabled}
              onChange={(event) =>
                write(pairs.map((pair, other) => (other === at ? [pair[0], event.target.value.trim()] : pair)))
              }
              onKeyDown={(event) => {
                escapeOfField(event, () => write(pairs.map((pair, other) => (other === at ? [pair[0], ""] : pair))));
              }}
            />
            <Button
              plain
              data-testid={`${id}-remove-${at}`}
              aria-label={RESTORE_CREATE_VIEW_WORDS.mappingRemove(source)}
              tooltip={RESTORE_CREATE_VIEW_WORDS.mappingRemove(source)}
              disabled={disabled}
              onClick={() => {
                write(pairs.filter((_pair, other) => other !== at));
                setFocus(
                  pairs.length > 1
                    ? `[data-testid="${id}-source-${Math.min(at, pairs.length - 2)}"]`
                    : `[data-testid="${id}-add"]`,
                );
              }}
            >
              <Icon material="close" small aria-hidden />
            </Button>
          </div>
        ))}
        <div className={styles.writeActions}>
          <Button
            plain
            data-testid={`${id}-add`}
            disabled={disabled}
            onClick={() => {
              write([...pairs, ["", ""]]);
              setFocus(`[data-testid="${id}-source-${pairs.length}"]`);
            }}
          >
            <Icon material="add" small aria-hidden />
            {RESTORE_CREATE_VIEW_WORDS.mappingAdd}
          </Button>
        </div>
        <p id={`${id}-not-set`} className={styles.factNote}>
          Not set: {RESTORE_FIELD_WORDS.namespaceMapping.notSet}
        </p>
        {problems?.length ? (
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

// A choice among a few, as radio buttons in a group named by its legend.
function ChoiceField<Value extends string>({
  id,
  label,
  choices,
  value,
  disabled,
  problems,
  onChoice,
}: {
  id: string;
  label: string;
  choices: Record<Value, string>;
  value: Value | undefined;
  disabled: boolean;
  problems?: string[];
  onChoice(value: Value): void;
}) {
  return (
    <fieldset
      className={styles.templateField}
      data-testid={id}
      aria-describedby={problems?.length ? `${id}-problem` : undefined}
    >
      <legend className={styles.factName}>{label}</legend>
      {(Object.entries(choices) as [Value, string][]).map(([choice, words]) => (
        <label key={choice} className={styles.templateChoice}>
          <input
            type="radio"
            name={id}
            data-testid={`${id}-${choice}`}
            checked={value === choice}
            disabled={disabled}
            onChange={() => onChoice(choice)}
          />
          {words}
        </label>
      ))}
      {problems?.length ? (
        <ul id={`${id}-problem`} className={styles.formError} data-testid={`${id}-problem`}>
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
    </fieldset>
  );
}

// A restore of a backup (SPEC-0017, REQ-252, REQ-265 to REQ-273): the name of the restore and the backup it is of, the
// fields of its form, the review of what the main process will send beside what it means, with the name of the backup
// typed before the restore is created, and what Velero wrote of the restore once it was created, one after the other in
// the same place, over the view it was asked from.
export const RestoreCreateWorkspace = observer(({ installation, from, back, onBack }: RestoreCreateWorkspaceProps) => {
  const namespace = installation.namespace ?? "";
  const state = installation.restoreCreate;
  const step = state.step;
  const writes = installation.writes;
  const gate = installation.gate;
  const body = React.useRef<HTMLDivElement>(null);
  const status = React.useRef<HTMLDivElement>(null);
  const gesture = React.useRef(false);
  const by = (act: () => void) => () => {
    gesture.current = true;
    act();
  };
  const backupsRead = installation.read("backups");
  const restoresRead = installation.read("restores");
  const backups = backupsRead.items as BackupResource[];
  const candidates =
    from.kind === "backup"
      ? { offered: backups.filter((backup) => backup.metadata.name === from.name) }
      : scheduleCandidates(backups, from.name);
  const first =
    from.kind === "backup" ? candidates.offered[0] : (candidates as ReturnType<typeof scheduleCandidates>).chosen;
  const chosen = backups.find((backup) => backup.metadata.name === state.backup?.name);
  // The namespaces the host lists, once its store loaded them: before, whether a target is listed is not known.
  const listed = hostNamespacesKnown() ? hostNamespaces().map((namespace) => namespace.name) : undefined;
  const offeredKey = candidates.offered.map((backup) => `${backup.metadata.name}/${backup.metadata.uid ?? ""}`).join();
  const busy =
    step.state === "asking"
      ? RESTORE_CREATE_VIEW_WORDS.asking
      : step.state === "running"
        ? RESTORE_CREATE_VIEW_WORDS.running(step.name)
        : "";

  // The form is of the view it was asked from: one opened from the address, or from another view, is started here, with
  // the backup the view offers once it is read; a backup that is not among the ones the view offers any more, gone or
  // created again under its name, gives its place to the one the view offers now.
  React.useEffect(() => {
    if (state.from?.kind !== from.kind || state.from.name !== from.name)
      state.start(from, first ? restoreBackupOf(first) : undefined);
    else if (
      first &&
      !candidates.offered.some(
        (backup) => backup.metadata.name === state.backup?.name && (backup.metadata.uid ?? "") === state.backup?.uid,
      )
    )
      state.choose(restoreBackupOf(first));
  }, [state, from.kind, from.name, first, offeredKey]);

  // An end the workspace shows is seen: it is not said again elsewhere.
  const ended = step.state === "created" || step.state === "failed";

  React.useEffect(() => {
    if (ended) state.see();
  }, [state, ended, step]);

  // A review is left with the workspace that shows it.
  React.useEffect(() => () => state.leave(), [state]);

  // The focus of a control that went is given to what took its place, as in every workspace of an action.
  React.useEffect(() => {
    if (!gesture.current) return;
    if (!busy) gesture.current = false;
    const active = document.activeElement;
    const free = !active || active === document.body || active === status.current || active.matches(":disabled");

    if (!free && document.body.contains(active)) return;
    if (busy) status.current?.focus();
    else
      focusFirst(body.current, [
        `[data-testid="${ID}-review"]`,
        `[data-testid="${ID}-result"]`,
        `[data-testid="${ID}-ask"]:not(:disabled)`,
        `[data-testid="${ID}-to-target"]`,
        `[data-testid="${ID}-failure"]`,
      ]);
  }, [busy, step.state]);

  const nameProblem = state.nameProblem;
  const taken = (restoresRead.items as RestoreResource[]).some((restore) => restore.metadata.name === state.name);
  const problems = state.problems;
  const refused = Object.keys(problems).length > 0;
  const offered = backupOffered(chosen?.status?.phase);
  // What holds the review back that the main process does not see: no backup read, as the read of the backups says,
  // or one not offered.
  const known = backupsRead.status === "ready" || backupsRead.lastSuccess !== undefined;
  const blockers = !chosen
    ? [
        known
          ? from.kind === "schedule"
            ? RESTORE_CREATE_VIEW_WORDS.noBackup(from.name)
            : RESTORE_CREATE_VIEW_WORDS.backupMissing(from.name, namespace)
          : backupsRead.status === "forbidden"
            ? RESTORE_CREATE_VIEW_WORDS.backupsForbidden
            : backupsRead.status === "idle" || backupsRead.status === "loading"
              ? RESTORE_CREATE_VIEW_WORDS.backupNotRead
              : RESTORE_CREATE_VIEW_WORDS.backupsFailed,
      ]
    : offered.offered
      ? []
      : [offered.words ?? ""];
  const holdBack = Boolean(nameProblem) || refused || blockers.length > 0;
  const noWay = !gate && installation.gateFailure !== undefined && !installation.gateUnknown;
  const cluster = gate?.cluster.name ?? installation.cluster.name;
  const context = gate?.cluster.context ?? "";
  const editing = step.state === "form" || step.state === "failed";
  const ask = by(() => void state.review(blockers));
  // The backups of a schedule listed to choose from: the newest, and the one chosen when it is older.
  const choices = candidates.offered.slice(0, OFFERED_BOUND);
  const older = candidates.offered.length - choices.length;

  if (chosen && !choices.includes(chosen) && candidates.offered.includes(chosen)) choices.push(chosen);
  const fromNotes = [
    blockers.length ? `${ID}-from-problem` : offered.words ? `${ID}-from-note` : "",
    older > 0 ? `${ID}-from-older` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const sources = offeredNames(state.backup?.namespaces.includedNamespaces);
  // The selectors are the ones of the form of the template, written in the fields of the restore.
  const selectors = {
    get template(): BackupTemplate {
      return { labelSelector: state.form.labelSelector, orLabelSelectors: state.form.orLabelSelectors };
    },
    get problems(): TemplateProblems {
      return { labelSelector: problems.labelSelector, orLabelSelectors: problems.orLabelSelectors };
    },
    set: <Field extends TemplateField>(field: Field, value: BackupTemplate[Field] | undefined) =>
      state.set(field as "labelSelector" | "orLabelSelectors", value as string & string[]),
  };

  return (
    <Workspace
      kind={from.kind === "backup" ? "restore-backup" : "restore-schedule"}
      name={from.name}
      title="Restore"
      back={back}
      onBack={onBack}
    >
      <div ref={body} data-testid={`${ID}-body`} data-step={step.state}>
        <p className={styles.factNote} data-testid={`${ID}-what`}>
          {RESTORE_CREATE_VIEW_WORDS.what(namespace)}
        </p>
        {step.state === "reviewing" ? (
          <Review
            installation={installation}
            state={state}
            name={step.name}
            backup={step.backup.name}
            text={step.text}
            replaced={step.replaced === true}
            cluster={cluster}
            context={context}
            listed={listed}
            phase={chosen?.status?.phase}
            location={chosen?.spec?.storageLocation}
            onCreate={by(() => void state.create())}
            onBack={by(() => state.leave())}
          />
        ) : step.state === "created" ? (
          <section
            className={styles.writeConfirmation}
            data-testid={`${ID}-result`}
            data-phase={step.restore.phase ?? ""}
            aria-label={RESTORE_CREATE_VIEW_WORDS.created(step.restore.name, namespace)}
            tabIndex={-1}
          >
            <p className={styles.stateText}>{RESTORE_CREATE_VIEW_WORDS.created(step.restore.name, namespace)}</p>
            {step.restore.found ? (
              <p className={styles.factNote} data-testid={`${ID}-found`}>
                {RESTORE_CREATE_VIEW_WORDS.found}
              </p>
            ) : null}
            <p className={styles.stateText} data-testid={`${ID}-phase`}>
              {restoreResultWords(step.restore.phase)}
            </p>
            {step.restore.errors ? (
              <ul className={`${styles.stateText} ${styles.preLine}`} data-testid={`${ID}-errors`}>
                {step.restore.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : null}
            {step.restore.errorsLeft ? (
              <p className={styles.factNote} data-testid={`${ID}-errors-left`}>
                {RESTORE_CREATE_VIEW_WORDS.errorsLeft(step.restore.errorsLeft)}
              </p>
            ) : null}
            <p className={styles.factNote}>{RESTORE_CREATE_VIEW_WORDS.listed}</p>
            <div className={styles.writeActions}>
              <Button
                primary
                data-testid={`${ID}-open`}
                onClick={() => replaceView({ kind: "restore", name: step.restore.name })}
              >
                <Icon material="open_in_new" small aria-hidden />
                Open the restore {step.restore.name}
              </Button>
            </div>
          </section>
        ) : (
          <>
            {step.state === "failed" ? (
              <div
                data-testid={`${ID}-failure`}
                data-code={step.failure.code}
                data-stage={step.failure.stage}
                data-left={step.left}
                role="alert"
                tabIndex={-1}
              >
                <p className={styles.stateText} data-testid={`${ID}-failure-text`}>
                  {step.failure.text}
                </p>
                {step.failure.code === "conflict" && step.failure.stage === "creation" ? (
                  <p className={styles.factNote}>
                    <ViewLink target={{ kind: "restore", name: step.name }}>Open the restore {step.name}</ViewLink>
                  </p>
                ) : null}
                {step.left === "unknown" ? (
                  <>
                    <p className={styles.factNote} data-testid={`${ID}-failure-left`}>
                      {RESTORE_CREATE_VIEW_WORDS.unknownLeft}
                    </p>
                    <p className={styles.factNote}>
                      <ViewLink target={{ kind: "restore", name: step.name }}>
                        {RESTORE_CREATE_VIEW_WORDS.lookFor(step.name)}
                      </ViewLink>
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}
            <div className={styles.backupName}>
              <span id={`${ID}-name-label`} className={styles.factName}>
                Name of the restore
              </span>
              {/* Escape in the field gives the proposal back, and goes no further; Enter asks for the review. */}
              <Input
                theme="round-black"
                aria-labelledby={`${ID}-name-label`}
                aria-describedby={`${ID}-name-rule${nameProblem ? ` ${ID}-name-problem` : ""}${taken ? ` ${ID}-name-taken` : ""}`}
                aria-invalid={nameProblem ? true : undefined}
                data-testid={`${ID}-field`}
                value={state.name}
                disabled={!editing}
                blurOnEnter={false}
                onChange={(next) => state.type(next)}
                onSubmit={ask}
                onKeyDown={(event) => {
                  escapeOfField(event, () => state.propose());
                }}
              />
              <p id={`${ID}-name-rule`} className={styles.factNote}>
                {RESTORE_CREATE_VIEW_WORDS.nameRule}
              </p>
              {nameProblem ? (
                <p id={`${ID}-name-problem`} className={styles.formError} data-testid={`${ID}-name-problem`}>
                  {nameProblem}
                </p>
              ) : null}
              {taken ? (
                <p id={`${ID}-name-taken`} className={styles.factNote} data-testid={`${ID}-name-taken`}>
                  {RESTORE_CREATE_VIEW_WORDS.nameTaken(state.name)}
                </p>
              ) : null}
            </div>
            <fieldset
              className={styles.templateField}
              data-testid={`${ID}-from`}
              aria-describedby={fromNotes || undefined}
            >
              <legend className={styles.factName}>{RESTORE_CREATE_VIEW_WORDS.from}</legend>
              {from.kind === "schedule" ? (
                <>
                  <p className={styles.factNote}>{RESTORE_CREATE_VIEW_WORDS.fromSchedule(from.name)}</p>
                  {choices.map((backup) => (
                    <label key={backup.metadata.name} className={styles.templateChoice}>
                      <input
                        type="radio"
                        name={`${ID}-from`}
                        data-testid={`${ID}-from-${backup.metadata.name}`}
                        checked={state.backup?.name === backup.metadata.name}
                        disabled={!editing}
                        onChange={() => state.choose(restoreBackupOf(backup))}
                      />
                      {backup.metadata.name}, {backup.status?.phase}
                    </label>
                  ))}
                  {older > 0 ? (
                    <p id={`${ID}-from-older`} className={styles.factNote} data-testid={`${ID}-from-older`}>
                      {RESTORE_CREATE_VIEW_WORDS.olderBackups(older)}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className={styles.stateText} data-testid={`${ID}-from-backup`}>
                  {from.name}
                  {chosen?.status?.phase ? `, ${chosen.status.phase}` : ""}
                </p>
              )}
              {blockers.length ? (
                <p id={`${ID}-from-problem`} className={styles.formError} data-testid={`${ID}-from-problem`}>
                  {blockers.join(" ")}
                </p>
              ) : offered.words ? (
                <p id={`${ID}-from-note`} className={styles.factNote} data-testid={`${ID}-from-note`}>
                  {offered.words}
                </p>
              ) : null}
            </fieldset>
            <div className={styles.templateForm} data-testid={`${ID}-form`}>
              {(["includedNamespaces", "excludedNamespaces"] as const).map((field) => (
                <NamesField
                  key={field}
                  id={`${ID}-${field}`}
                  label={RESTORE_FIELD_WORDS[field].label}
                  notSet={RESTORE_FIELD_WORDS[field].notSet}
                  offered={sources}
                  items={state.form[field] ?? []}
                  problems={problems[field]}
                  disabled={!editing}
                  onItems={(items) => state.set(field, items)}
                  onSubmit={ask}
                />
              ))}
              <MappingField state={state} offered={sources} listed={listed} disabled={!editing} />
              {(["includedResources", "excludedResources"] as const).map((field) => (
                <div key={field} className={styles.templateField}>
                  <ItemsField
                    id={`${ID}-${field}`}
                    label={RESTORE_FIELD_WORDS[field].label}
                    items={state.form[field] ?? []}
                    disabled={!editing}
                    describedBy={`${ID}-${field}-not-set${problems[field]?.length ? ` ${ID}-${field}-problem` : ""}`}
                    invalid={Boolean(problems[field]?.length)}
                    onItems={(items) => state.set(field, items)}
                    onSubmit={ask}
                  />
                  <p id={`${ID}-${field}-not-set`} className={styles.factNote}>
                    Not set: {RESTORE_FIELD_WORDS[field].notSet}
                  </p>
                  {problems[field]?.length ? (
                    <ul
                      id={`${ID}-${field}-problem`}
                      className={styles.formError}
                      data-testid={`${ID}-${field}-problem`}
                    >
                      {(problems[field] ?? []).map((problem) => (
                        <li key={problem}>{problem}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
              <ChoiceField<ClusterResources>
                id={`${ID}-clusterResources`}
                label={RESTORE_FIELD_WORDS.clusterResources.label}
                choices={RESTORE_FIELD_WORDS.clusterResources.choices}
                value={state.form.clusterResources}
                disabled={!editing}
                problems={problems.clusterResources}
                onChoice={(choice) => state.set("clusterResources", choice)}
              />
              <SelectorField state={selectors} id={`${ID}-labelSelector`} disabled={!editing} onSubmit={ask} />
              <ChoiceField<"unset" | "true" | "false">
                id={`${ID}-restorePVs`}
                label={RESTORE_FIELD_WORDS.restorePVs.label}
                choices={RESTORE_FIELD_WORDS.restorePVs.choices}
                value={state.form.restorePVs === undefined ? "unset" : state.form.restorePVs ? "true" : "false"}
                disabled={!editing}
                onChoice={(choice) => state.set("restorePVs", choice === "unset" ? undefined : choice === "true")}
              />
              <ChoiceField<ExistingResourcePolicy>
                id={`${ID}-existingResourcePolicy`}
                label={RESTORE_FIELD_WORDS.existingResourcePolicy.label}
                choices={RESTORE_FIELD_WORDS.existingResourcePolicy.choices}
                value={state.form.existingResourcePolicy}
                disabled={!editing}
                onChoice={(choice) => state.set("existingResourcePolicy", choice)}
              />
              {state.warnings.length ? (
                <ul className={styles.factNote} data-testid={`${ID}-warnings`}>
                  {state.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              <p className={styles.factNote} data-testid={`${ID}-not-offered`}>
                {NOT_OFFERED_OF_A_RESTORE}
              </p>
            </div>
            <div
              ref={status}
              role="status"
              tabIndex={-1}
              className={busy ? `${styles.factNote} ${styles.serverFocus}` : undefined}
              data-testid={`${ID}-status`}
            >
              {busy}
            </div>
            {busy ? null : !writes.on ? (
              <>
                <p className={styles.factNote} data-testid={`${ID}-writes-off`}>
                  {noWay
                    ? installation.gateFailure
                    : installation.gateUnknown
                      ? BACKUP_CREATE_VIEW_WORDS.gateUnknown
                      : RESTORE_CREATE_VIEW_WORDS.writesOff}
                </p>
                {noWay ? null : (
                  <div className={styles.writeActions}>
                    <button
                      type="button"
                      className={styles.link}
                      data-testid={`${ID}-to-target`}
                      onClick={(event) =>
                        focusFirst(event.currentTarget.ownerDocument.body, [
                          '[data-testid="velero-writes-on"]',
                          '[data-testid="velero-writes-ask"]',
                        ])
                      }
                    >
                      Go to the writes in the target bar
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className={styles.writeActions}>
                <Button
                  primary
                  data-testid={`${ID}-ask`}
                  disabled={holdBack}
                  aria-describedby={holdBack ? `${ID}-held` : undefined}
                  onClick={ask}
                >
                  <Icon material="fact_check" small aria-hidden />
                  Review the restore
                </Button>
                {holdBack ? (
                  <p id={`${ID}-held`} className={styles.factNote} data-testid={`${ID}-held`}>
                    {!state.name
                      ? RESTORE_CREATE_VIEW_WORDS.heldName
                      : problems.clusterResources
                        ? RESTORE_CREATE_VIEW_WORDS.heldClusterResources
                        : RESTORE_CREATE_VIEW_WORDS.held}
                  </p>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    </Workspace>
  );
});

interface ReviewProps {
  installation: Installation;
  state: RestoreCreate;
  name: string;
  backup: string;
  text: string;
  replaced: boolean;
  cluster: string;
  context: string;
  listed: string[] | undefined;
  phase?: string;
  location?: string;
  onCreate: () => void;
  onBack: () => void;
}

// The review is the confirmation (SPEC-0017, REQ-268 to REQ-271): the text the main process will send, as it came,
// beside what it means, with the context and the namespace; and the field where the name of the backup is typed, which
// enables the command that creates once it is the name as it is written. Escape leaves it, and the workspace stays. The
// focus is not on the command that creates.
const Review = observer(
  ({
    installation,
    state,
    name,
    backup,
    text,
    replaced,
    cluster,
    context,
    listed,
    phase,
    location,
    onCreate,
    onBack,
  }: ReviewProps) => {
    const body = readRestoreBody(text);
    const meaning = body
      ? restoreCreateMeaning(body, {
          ...(listed ? { listed } : {}),
          ...(phase ? { backupPhase: phase } : {}),
          ...(location ? { storageLocation: location } : {}),
          warnings: state.warnings,
        })
      : [];
    const confirmed = state.confirmed;

    return (
      <section
        className={`${styles.writeConfirmation} ${styles.review}`}
        data-testid={`${ID}-review`}
        aria-label="The Restore that will be created"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          onBack();
        }}
      >
        {replaced ? (
          <p className={styles.stateText} data-testid={`${ID}-replaced`} role="status">
            {RESTORE_CREATE_VIEW_WORDS.replaced}
          </p>
        ) : null}
        <p className={styles.stateText}>{RESTORE_CREATE_VIEW_WORDS.review}</p>
        <div className={styles.band}>
          <Fact name="Name">{name}</Fact>
          <Fact name="Backup">{backup}</Fact>
          <Fact name="Namespace">{installation.namespace ?? ""}</Fact>
          <Fact name="Cluster">{context ? `${cluster} (context ${context})` : cluster}</Fact>
        </div>
        <div className={styles.reviewColumns}>
          <div className={styles.reviewPart}>
            <h4 className={styles.factName}>{RESTORE_CREATE_VIEW_WORDS.meaning}</h4>
            <ul className={styles.reviewMeaning} data-testid={`${ID}-meaning`}>
              {meaning.map((part) => (
                <li key={part.id} className={styles.reviewMeaningPart} data-part={part.id}>
                  {part.words}
                </li>
              ))}
            </ul>
            <p className={styles.factNote}>
              <button
                type="button"
                className={styles.link}
                data-testid={`${ID}-backup-resources`}
                onClick={() => openViewAt({ kind: "backup", name: backup }, "resources")}
              >
                {RESTORE_CREATE_VIEW_WORDS.backupResources(backup)}
              </button>
            </p>
          </div>
          <ReviewText id={ID} title={RESTORE_CREATE_VIEW_WORDS.text}>
            {text}
          </ReviewText>
        </div>
        <div className={styles.backupName}>
          <span id={`${ID}-typed-label`} className={styles.factName}>
            Name of the backup
          </span>
          {/* The second gesture: the name of the backup typed as it is written. Escape in the field takes back what was
              typed; Enter creates the restore once it is the name. */}
          <Input
            theme="round-black"
            aria-labelledby={`${ID}-typed-label`}
            aria-describedby={`${ID}-typed-rule ${ID}-typed-state`}
            data-testid={`${ID}-typed`}
            value={state.typed}
            blurOnEnter={false}
            onChange={(next) => state.typeBackup(next)}
            onSubmit={() => {
              if (state.confirmed) onCreate();
            }}
            onKeyDown={(event) => {
              escapeOfField(event, () => state.typeBackup(""));
            }}
          />
          <p id={`${ID}-typed-rule`} className={styles.factNote}>
            {RESTORE_CREATE_VIEW_WORDS.typeBackup(backup)}
          </p>
          <p id={`${ID}-typed-state`} className={styles.factNote} data-testid={`${ID}-typed-state`} aria-live="polite">
            {confirmed ? RESTORE_CREATE_VIEW_WORDS.typed : RESTORE_CREATE_VIEW_WORDS.notTyped(backup)}
          </p>
        </div>
        <div className={styles.writeActions}>
          <Button primary data-testid={`${ID}-create`} disabled={!confirmed} onClick={onCreate}>
            <Icon material="restore" small aria-hidden />
            Create restore
          </Button>
          <Button plain data-testid={`${ID}-back`} onClick={onBack}>
            <Icon material="close" small aria-hidden />
            Do not create it
          </Button>
        </div>
      </section>
    );
  },
);
