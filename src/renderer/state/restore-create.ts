import { action, computed, makeObservable, observable, observableRef, runInAction } from "mobx";
import {
  type BackupNamespaces,
  proposedRestoreName,
  type RestoreField,
  type RestoreForm,
  type RestoreProblems,
  readRestoreBody,
  restoreNameProblem,
  restoreProblems,
} from "../../common/restore-form";
import { type BackupLeft, backupLeft } from "./backup-now";

import type { Failure, RestoreCreated, WriteTarget } from "../../common/ipc";
import type { RestoreCreateClient } from "../api/ipc";

// Where a restore is asked from (SPEC-0017, REQ-265): the view of a backup, for that backup; or the view of a schedule,
// for one of its backups.
export type RestoreFrom = { kind: "backup"; name: string } | { kind: "schedule"; name: string };

// The backup a restore is of, by its name and its UID, with the namespaces its spec names, which the mapping is matched
// against.
export interface RestoreBackup {
  name: string;
  uid: string;
  namespaces: BackupNamespaces;
}

// How a restore ended: created, with what Velero wrote of it; or without a restore, with the words of the main process,
// the name that was asked and whether it may be there. The identifier of the request is the one of the run, which the
// main process keeps the end of for the cluster until a view showed it (REQ-250).
export type RestoreCreateEnd =
  | { state: "created"; restore: RestoreCreated; request: string }
  | { state: "failed"; failure: Failure; left: BackupLeft; name: string; request?: string };

// Where a restore is: the form; the review asked of the main process; the review shown, with its token, the text it will
// send and the backup it is of, and whether it took the place of another; the restore created and read; or its end.
export type RestoreCreateStep =
  | { state: "form" }
  | { state: "asking" }
  | {
      state: "reviewing";
      token: string;
      expires: number;
      text: string;
      name: string;
      backup: WriteTarget;
      replaced?: true;
    }
  | { state: "running"; request: string; name: string; backup: WriteTarget }
  | RestoreCreateEnd;

export interface RestoreCreateDependencies {
  client?: RestoreCreateClient;
  cluster(): string;
  namespace(): string | undefined;
  // Whether the main process last said that writes are on for the installation that is shown.
  writesOn(): boolean;
  now(): number;
  // The identifier of a new request.
  requestId(): string;
  // The main process refused, or the write did not end well: what it holds of the gate may not be what the views show
  // any more, and it is asked.
  refused(): void;
  // A view showed the end of a run: the main process keeps it no more.
  shown?(request: string): void;
}

const NO_WAY: Failure = {
  ok: false,
  code: "request-failed",
  stage: "way",
  retry: false,
  text: "The views have no way to the main process of the extension: the restore cannot be asked.",
};

// A review the views cannot show is not confirmed: the text of a Restore is what the operator confirms.
const NO_TEXT: Failure = {
  ok: false,
  code: "validation",
  stage: "review",
  retry: false,
  text: "The main process answered no text of a restore that the review can show: nothing can be confirmed, and nothing was created.",
};

// Where a write fails when it is not known what the main process did.
const NOT_KNOWN = ["way", "answer", "handler"];

// The form of a new restore: the policy for the resources that exist is none until another is chosen, and always
// written (D8); the cluster-scoped resources are chosen by the operator (D15).
const NEW_FORM: RestoreForm = { existingResourcePolicy: "none" };

// A restore of a backup, for the installation that is shown: one at a time (SPEC-0017, REQ-249, REQ-265). The name is
// proposed as the command line proposes it, from the backup and the clock in UTC, and is the operator's once typed. The
// form keeps what was typed while the review is shown and after a failure, so that the operator corrects it and asks
// for a new review; a change of a field or of the backup drops the review and its token, as writes turned off do, and
// the installation that changes drops everything. The name of the backup typed in the review is the second gesture of
// REQ-271, which the main process compares again. What the main process answers is taken only by the step that asked
// it.
export class RestoreCreate {
  step: RestoreCreateStep = { state: "form" };
  // Where the restore was asked from, and the backup it is of.
  from: RestoreFrom | undefined = undefined;
  backup: RestoreBackup | undefined = undefined;
  // The name of the restore, as it is in the field, and whether it is the one the form proposed.
  name = "";
  proposed = false;
  // The fields of the form, as the form holds them.
  form: RestoreForm = NEW_FORM;
  // The name of the backup as it is typed in the review.
  typed = "";
  private readonly dependencies: RestoreCreateDependencies;

  constructor(dependencies: RestoreCreateDependencies) {
    this.dependencies = dependencies;
    makeObservable(this, {
      step: observableRef,
      from: observableRef,
      backup: observableRef,
      name: observable,
      proposed: observable,
      form: observableRef,
      typed: observable,
      nameProblem: computed,
      problems: computed,
      warnings: computed,
      confirmed: computed,
      start: action,
      choose: action,
      type: action,
      propose: action,
      set: action,
      typeBackup: action,
      see: action,
      leave: action,
      drop: action,
    });
  }

  // What is wrong with the name in words, as the main process checks it again.
  get nameProblem(): string | undefined {
    return restoreNameProblem(this.name);
  }

  // What the restore controller refuses of the form, field by field, with its words, and what the form refuses beside
  // it, against the namespaces of the backup.
  get problems(): RestoreProblems {
    return restoreProblems(this.form, this.backup?.namespaces ?? {}).problems;
  }

  // What the form keeps with words: a mapping a backup of every namespace may not hold.
  get warnings(): string[] {
    return restoreProblems(this.form, this.backup?.namespaces ?? {}).warnings;
  }

  // Whether the name of the backup is typed as it is written, which the command that creates waits for.
  get confirmed(): boolean {
    return this.step.state === "reviewing" && this.typed === this.step.backup.name;
  }

  // Whether a restore is being asked: no other is asked meanwhile.
  get busy(): boolean {
    return this.step.state === "asking" || this.step.state === "running";
  }

  // The command of a view: the form of a restore of what the view shows. A form of the same source that is being
  // filled, or whose restore was not created, is shown as it was left, of the backup the view offers now: a backup
  // created again under its name, or a newer one of a schedule, takes the place of the one it was of. A restore that is
  // being created goes on; a new source, or a restore created, gives a new form, with the name proposed for the backup.
  // An end no workspace showed is not lost: the main process keeps it for the target bar (REQ-250).
  start(from: RestoreFrom, backup: RestoreBackup | undefined): void {
    if (this.busy) return;
    const same = this.from?.kind === from.kind && this.from.name === from.name;

    if (same && this.step.state !== "created") {
      if (backup && (backup.uid !== this.backup?.uid || backup.name !== this.backup?.name)) this.choose(backup);
      return;
    }
    this.step = { state: "form" };
    this.from = from;
    this.form = NEW_FORM;
    this.typed = "";
    this.backup = undefined;
    this.name = "";
    this.proposed = false;
    this.choose(backup);
  }

  // The backup the restore is of: from a schedule, the one chosen among its backups. A name the form proposed is
  // proposed again for it; one the operator typed is kept.
  choose(backup: RestoreBackup | undefined): void {
    if (this.busy) return;
    const changed = backup?.uid !== this.backup?.uid || backup?.name !== this.backup?.name;

    this.backup = backup;
    if (backup && (this.proposed || this.name === "")) {
      this.name = proposedRestoreName(backup.name, this.dependencies.now());
      this.proposed = true;
    }
    if (changed) this.changed();
  }

  // The name typed: a review shown is of another restore, and goes with its token.
  type(name: string): void {
    this.name = name;
    this.proposed = false;
    this.changed();
  }

  // Escape in the field of the name gives the proposal back: the name of the backup and the clock in UTC, or nothing
  // while no backup is chosen.
  propose(): void {
    if (this.busy) return;
    this.name = this.backup ? proposedRestoreName(this.backup.name, this.dependencies.now()) : "";
    this.proposed = this.backup !== undefined;
    this.changed();
  }

  // A field of the form set, or not set with nothing: a review shown goes with its token.
  set<Field extends RestoreField>(field: Field, value: RestoreForm[Field] | undefined): void {
    const form = { ...this.form };

    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      if (field !== "existingResourcePolicy") delete form[field];
    } else form[field] = value as RestoreForm[Field];
    this.form = form;
    this.changed();
  }

  // The name of the backup typed in the review, the second gesture: it drops nothing.
  typeBackup(typed: string): void {
    this.typed = typed;
  }

  // A workspace showed the end of the step: the main process is told, when the end is of a run and is its end.
  see(): void {
    const step = this.step;

    if (step.state === "created" && step.request) this.dependencies.shown?.(step.request);
    if (step.state === "failed" && step.request && !NOT_KNOWN.includes(step.failure.stage))
      this.dependencies.shown?.(step.request);
  }

  // The first gesture: the main process is asked for the review of the restore, which it builds from the fields and the
  // backup it reads again, and answers the text it will send. Nothing is created. What the form says is wrong of what
  // the cluster holds is given by the workspace, which reads it, and holds the review back as well.
  async review(blockers: readonly string[] = []): Promise<void> {
    const namespace = this.dependencies.namespace();
    const client = this.dependencies.client;
    const backup = this.backup;
    const name = this.name;
    const form = this.form;

    if (!namespace || !backup || !this.dependencies.writesOn() || this.nameProblem || blockers.length > 0) return;
    if (Object.keys(this.problems).length > 0) return;
    if (this.step.state !== "form" && this.step.state !== "failed") return;
    if (!client) {
      this.take({ state: "failed", failure: NO_WAY, left: "none", name });
      return;
    }
    const target: WriteTarget = { kind: "Backup", name: backup.name, uid: backup.uid };
    const asking = this.take({ state: "asking" });
    const answer = await client.confirmRestoreCreate(this.dependencies.cluster(), namespace, target, name, form);

    if (!this.at(asking)) return;
    if (!answer.ok) this.fail(answer, "none", name);
    else if (!answer.value.text || !readRestoreBody(answer.value.text))
      this.take({ state: "failed", failure: NO_TEXT, left: "none", name });
    else {
      this.typed = "";
      this.take({
        state: "reviewing",
        token: answer.value.token,
        expires: answer.value.expires,
        text: answer.value.text,
        name,
        backup: target,
      });
    }
  }

  // The second gesture done, the restore is created with the token of its review, and read until Velero writes its
  // phase. A token that expired while the review was read is asked again once, and the run goes on only when the main
  // process answers the same text; another text is a new review, shown in place of the old one, and nothing is sent.
  async create(): Promise<void> {
    const shown = this.step;
    const namespace = this.dependencies.namespace();
    const client = this.dependencies.client;
    const form = this.form;
    const typed = this.typed;

    if (shown.state !== "reviewing" || !namespace || !client || !this.dependencies.writesOn()) return;
    if (typed !== shown.backup.name) return;
    const running = this.take({
      state: "running",
      request: this.dependencies.requestId(),
      name: shown.name,
      backup: shown.backup,
    });
    let token = shown.token;

    if (this.dependencies.now() >= shown.expires) {
      const renewed = await client.confirmRestoreCreate(
        this.dependencies.cluster(),
        namespace,
        shown.backup,
        shown.name,
        form,
      );

      if (!this.at(running)) return;
      if (!renewed.ok) {
        this.fail(renewed, "none", shown.name);
        return;
      }
      if (!renewed.value.text || !readRestoreBody(renewed.value.text)) {
        this.take({ state: "failed", failure: NO_TEXT, left: "none", name: shown.name });
        return;
      }
      if (renewed.value.text !== shown.text) {
        this.typed = "";
        this.take({
          state: "reviewing",
          token: renewed.value.token,
          expires: renewed.value.expires,
          text: renewed.value.text,
          name: shown.name,
          backup: shown.backup,
          replaced: true,
        });
        return;
      }
      token = renewed.value.token;
    }
    const answer = await client.runRestoreCreate(
      this.dependencies.cluster(),
      namespace,
      shown.backup,
      shown.name,
      typed,
      token,
      running.request,
    );

    if (!this.at(running)) return;
    if (answer.ok) {
      this.take({ state: "created", restore: answer.value, request: running.request });
      return;
    }
    // A name the API server answered with 409 is another restore's: the form keeps it, and the words lead to it.
    this.fail(answer, backupLeft(answer), shown.name, running.request);
  }

  // A review is left without creating anything: by its command, with the workspace that shows it, or because writes
  // went off. One that is still asked is left as well, and its answer is not taken.
  leave(): void {
    if (this.step.state === "asking" || this.step.state === "reviewing") this.step = { state: "form" };
  }

  // The installation changed: what was typed was of the one before, and nothing that was asked for it is taken.
  drop(): void {
    this.step = { state: "form" };
    this.from = undefined;
    this.backup = undefined;
    this.name = "";
    this.proposed = false;
    this.form = NEW_FORM;
    this.typed = "";
  }

  // A field changed: what is shown is the form again, but for a restore that is being created.
  private changed(): void {
    if (this.step.state !== "form" && this.step.state !== "running") this.step = { state: "form" };
  }

  private at(step: RestoreCreateStep): boolean {
    return this.step === step;
  }

  private take<Step extends RestoreCreateStep>(step: Step): Step {
    runInAction(() => {
      this.step = step;
    });
    return step;
  }

  private fail(failure: Failure, left: BackupLeft, name: string, request?: string): void {
    this.take({ state: "failed", failure, left, name, ...(request ? { request } : {}) });
    this.dependencies.refused();
  }
}
