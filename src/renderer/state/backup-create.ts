import { action, computed, makeObservable, observable, observableRef, runInAction } from "mobx";
import { readFormBody } from "../../common/backup-form";
import { backupNameProblem } from "../../common/backup-from-schedule";
import {
  type BackupTemplate,
  type TemplateField,
  type TemplateProblems,
  templateProblems,
} from "../../common/backup-template";
import { type BackupLeft, backupLeft } from "./backup-now";

import type { BackupCreated, Failure } from "../../common/ipc";
import type { BackupCreateClient } from "../api/ipc";

// How a backup of the form ended: created, with what Velero wrote of it; or without a backup, with the words of the
// main process, the name that was asked and whether it may be there. The identifier of the request is the one of the
// run, which the main process keeps the end of for the cluster until a view showed it (REQ-250).
export type BackupCreateEnd =
  | { state: "created"; backup: BackupCreated; request: string }
  | { state: "failed"; failure: Failure; left: BackupLeft; name: string; request?: string };

// Where a backup of the form is (SPEC-0017, REQ-252): the form; the review asked of the main process; the review shown,
// with its token and the text it will send, and whether it took the place of one whose locations changed while it was
// read; the backup created and read; or its end.
export type BackupCreateStep =
  | { state: "form" }
  | { state: "asking" }
  | { state: "reviewing"; token: string; expires: number; text: string; name: string; replaced?: true }
  | { state: "running"; request: string; name: string }
  | BackupCreateEnd;

export interface BackupCreateDependencies {
  client?: BackupCreateClient;
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
  text: "The views have no way to the main process of the extension: the backup cannot be asked.",
};

// A review the views cannot show is not confirmed: the text of a Backup is what the operator confirms.
const NO_TEXT: Failure = {
  ok: false,
  code: "validation",
  stage: "review",
  retry: false,
  text: "The main process answered no text of a backup that the review can show: nothing can be confirmed, and nothing was created.",
};

// Where a write fails when it is not known what the main process did.
const NOT_KNOWN = ["way", "answer", "handler"];

// A backup of the form, for the installation that is shown: one at a time (SPEC-0017, REQ-249, REQ-260). The form keeps
// what was typed while the review is shown and after a failure, so that the operator corrects it and asks for a new
// review; a change of a field drops the review and its token, as writes turned off do, and the installation that
// changes drops everything. What the main process answers is taken only by the step that asked it.
export class BackupCreate {
  step: BackupCreateStep = { state: "form" };
  // The name of the backup, as it is in the field: the operator's, never proposed.
  name = "";
  // The fields of the template, as the form holds them.
  template: BackupTemplate = {};
  // Whether a workspace showed the end of the step.
  seen = false;
  private readonly dependencies: BackupCreateDependencies;

  constructor(dependencies: BackupCreateDependencies) {
    this.dependencies = dependencies;
    makeObservable(this, {
      step: observableRef,
      name: observable,
      template: observableRef,
      seen: observable,
      nameProblem: computed,
      problems: computed,
      type: action,
      set: action,
      start: action,
      see: action,
      letGoOf: action,
      leave: action,
      drop: action,
    });
  }

  // What is wrong with the name in words, as the main process checks it again.
  get nameProblem(): string | undefined {
    return backupNameProblem(this.name);
  }

  // What the release refuses of the template, field by field, with its words.
  get problems(): TemplateProblems {
    return templateProblems(this.template);
  }

  // Whether a backup is being asked: no other is asked meanwhile.
  get busy(): boolean {
    return this.step.state === "asking" || this.step.state === "running";
  }

  // The name typed: a review shown is of another backup, and goes with its token.
  type(name: string): void {
    this.name = name;
    this.changed();
  }

  // A field of the template set, or not set with nothing: a review shown goes with its token.
  set<Field extends TemplateField>(field: Field, value: BackupTemplate[Field] | undefined): void {
    const template = { ...this.template };

    if (value === undefined || (Array.isArray(value) && value.length === 0)) delete template[field];
    else template[field] = value;
    this.template = template;
    this.changed();
  }

  // The command of the list: a new form once the backup of the form before was created, as the command of Back up now
  // gives one. A form that is being filled, or whose backup was not created, is shown as it was left, and a backup that
  // is being created goes on. An end no workspace showed is not lost with the form: the main process keeps it for the
  // target bar until a view shows it or the operator dismisses it (SPEC-0017, REQ-250).
  start(): void {
    if (this.step.state !== "created") return;
    this.step = { state: "form" };
    this.name = "";
    this.template = {};
    this.seen = false;
  }

  // A workspace showed the end of the step: the main process is told, when the end is of a run and is its end.
  see(): void {
    this.seen = true;
    const step = this.step;

    if (step.state === "created" && step.request) this.dependencies.shown?.(step.request);
    if (step.state === "failed" && step.request && !NOT_KNOWN.includes(step.failure.stage))
      this.dependencies.shown?.(step.request);
  }

  // The operator let an end go in the target bar: it is seen.
  letGoOf(request: string): void {
    const step = this.step;

    if ((step.state === "created" || step.state === "failed") && step.request === request) this.seen = true;
  }

  // The first gesture: the main process is asked for the review of the backup, which it builds from the fields and the
  // locations it reads, and answers the text it will send. Nothing is created. What the form says is wrong of what the
  // cluster holds, a namespace labelled to be excluded or no location that can be chosen, is given by the workspace,
  // which reads it, and holds the review back as well.
  async review(blockers: readonly string[] = []): Promise<void> {
    const namespace = this.dependencies.namespace();
    const client = this.dependencies.client;
    const name = this.name;
    const template = this.template;

    if (!namespace || !this.dependencies.writesOn() || this.nameProblem || blockers.length > 0) return;
    if (Object.keys(this.problems).length > 0) return;
    if (this.step.state !== "form" && this.step.state !== "failed") return;
    if (!client) {
      this.take({ state: "failed", failure: NO_WAY, left: "none", name });
      return;
    }
    const asking = this.take({ state: "asking" });
    const answer = await client.confirmBackupCreate(this.dependencies.cluster(), namespace, name, template);

    if (!this.at(asking)) return;
    if (!answer.ok) this.fail(answer, "none", name);
    else if (!answer.value.text || !readFormBody(answer.value.text))
      this.take({ state: "failed", failure: NO_TEXT, left: "none", name });
    else
      this.take({
        state: "reviewing",
        token: answer.value.token,
        expires: answer.value.expires,
        text: answer.value.text,
        name,
      });
  }

  // The second gesture: the backup is created with the token of its review, and read until Velero writes its phase. A
  // token that expired while the review was read is asked again once, and the run goes on only when the main process
  // answers the same text; another text is a new review, shown in place of the old one, and nothing is sent.
  async create(): Promise<void> {
    const shown = this.step;
    const namespace = this.dependencies.namespace();
    const client = this.dependencies.client;
    const template = this.template;

    if (shown.state !== "reviewing" || !namespace || !client || !this.dependencies.writesOn()) return;
    const running = this.take({ state: "running", request: this.dependencies.requestId(), name: shown.name });
    let token = shown.token;

    if (this.dependencies.now() >= shown.expires) {
      const renewed = await client.confirmBackupCreate(this.dependencies.cluster(), namespace, shown.name, template);

      if (!this.at(running)) return;
      if (!renewed.ok) {
        this.fail(renewed, "none", shown.name);
        return;
      }
      if (!renewed.value.text || !readFormBody(renewed.value.text)) {
        this.take({ state: "failed", failure: NO_TEXT, left: "none", name: shown.name });
        return;
      }
      if (renewed.value.text !== shown.text) {
        this.take({
          state: "reviewing",
          token: renewed.value.token,
          expires: renewed.value.expires,
          text: renewed.value.text,
          name: shown.name,
          replaced: true,
        });
        return;
      }
      token = renewed.value.token;
    }
    const answer = await client.runBackupCreate(
      this.dependencies.cluster(),
      namespace,
      shown.name,
      token,
      running.request,
    );

    if (!this.at(running)) return;
    if (answer.ok) {
      this.take({ state: "created", backup: answer.value, request: running.request });
      return;
    }
    // A name the API server answered with 409 is another backup's: the form keeps it, and the words lead to that
    // backup (SPEC-0017, REQ-262).
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
    this.name = "";
    this.template = {};
    this.seen = false;
  }

  // A field changed: what is shown is the form again, but for a backup that is being created.
  private changed(): void {
    if (this.step.state !== "form" && this.step.state !== "running") this.step = { state: "form" };
  }

  private at(step: BackupCreateStep): boolean {
    return this.step === step;
  }

  private take<Step extends BackupCreateStep>(step: Step): Step {
    runInAction(() => {
      this.step = step;
      if (step.state === "created" || step.state === "failed") this.seen = false;
    });
    return step;
  }

  private fail(failure: Failure, left: BackupLeft, name: string, request?: string): void {
    this.take({ state: "failed", failure, left, name, ...(request ? { request } : {}) });
    this.dependencies.refused();
  }
}
