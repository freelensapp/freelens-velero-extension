import { action, computed, makeObservable, observable, observableRef, runInAction } from "mobx";
import {
  type BackupTemplate,
  type TemplateField,
  type TemplateProblems,
  templateProblems,
} from "../../common/backup-template";
import { SCHEDULE_CREATE_VIEW_WORDS } from "../../common/schedule-create-words";
import {
  expressionProblem,
  expressionRefused,
  readScheduleBody,
  type ScheduleWrapper,
  scheduleNameProblem,
} from "../../common/schedule-form";
import { type BackupLeft, backupLeft } from "./backup-now";

import type { Failure, ScheduleCreated } from "../../common/ipc";
import type { ScheduleFlag } from "../../common/schedule-create-words";
import type { ScheduleCreateClient } from "../api/ipc";

// How a schedule of the form ended: created, with what Velero wrote of it; or without a schedule, with the words of
// the main process, the name that was asked and whether it may be there. The identifier of the request is the one of
// the run, which the main process keeps the end of for the cluster until a view showed it (SPEC-0016, REQ-243).
export type ScheduleCreateEnd =
  | { state: "created"; schedule: ScheduleCreated; request: string }
  | { state: "failed"; failure: Failure; left: BackupLeft; name: string; request?: string };

// Where a schedule of the form is (SPEC-0016, the states of the workspace): the form; the review asked of the main
// process; the review shown, with its token and the text it will send, and whether it took the place of another; the
// schedule created and read; or its end.
export type ScheduleCreateStep =
  | { state: "form" }
  | { state: "asking" }
  | { state: "reviewing"; token: string; expires: number; text: string; name: string; replaced?: true }
  | { state: "running"; request: string; name: string; paused: boolean }
  | ScheduleCreateEnd;

export interface ScheduleCreateDependencies {
  client?: ScheduleCreateClient;
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
  text: "The views have no way to the main process of the extension: the schedule cannot be asked.",
};

// A review the views cannot show is not confirmed: the text of a Schedule is what the operator confirms.
const NO_TEXT: Failure = {
  ok: false,
  code: "validation",
  stage: "review",
  retry: false,
  text: "The main process answered no text of a schedule that the review can show: nothing can be confirmed, and nothing was created.",
};

// Where a write fails when it is not known what the main process did.
const NOT_KNOWN = ["way", "answer", "handler"];

// The wrapper of a new form: no expression, and the three flags false, which the form always writes (D4).
const NEW_WRAPPER: ScheduleWrapper = {
  expression: "",
  paused: false,
  skipImmediately: false,
  useOwnerReferencesInBackup: false,
};

// A schedule of the form, for the installation that is shown: one at a time (SPEC-0016, REQ-239). The form keeps what
// was typed while the review is shown and after a failure, so that the operator corrects it and asks for a new review
// (REQ-227, REQ-228); a change of a field drops the review and its token, as writes turned off do, and the installation
// that changes drops everything (REQ-229). What the main process answers is taken only by the step that asked it.
export class ScheduleCreate {
  step: ScheduleCreateStep = { state: "form" };
  // The name of the schedule, as it is in the field: the operator's, never proposed.
  name = "";
  // The expression and the three flags, as the form holds them.
  wrapper: ScheduleWrapper = NEW_WRAPPER;
  // The fields of the template, as the form holds them.
  template: BackupTemplate = {};
  private readonly dependencies: ScheduleCreateDependencies;

  constructor(dependencies: ScheduleCreateDependencies) {
    this.dependencies = dependencies;
    makeObservable(this, {
      step: observableRef,
      name: observable,
      wrapper: observableRef,
      template: observableRef,
      nameProblem: computed,
      expressionWords: computed,
      problems: computed,
      type: action,
      write: action,
      flag: action,
      set: action,
      start: action,
      see: action,
      leave: action,
      drop: action,
    });
  }

  // What is wrong with the name in words, as the main process checks it again.
  get nameProblem(): string | undefined {
    return scheduleNameProblem(this.name);
  }

  // What is wrong with the expression in words: the words the controller writes for one its parser refuses, which the
  // form refuses (D11), said as Velero's; or, in its own words, what the main process refuses of one, an expression too
  // long, with a character that is not printable or with no instant among it (REQ-226), which Velero would take.
  get expressionWords(): string | undefined {
    const expression = this.wrapper.expression;

    if (expression === "") return undefined;
    const refused = expressionRefused(expression);

    return refused !== undefined
      ? SCHEDULE_CREATE_VIEW_WORDS.expressionRefused(refused)
      : expressionProblem(expression, this.dependencies.now());
  }

  // What the release refuses of the template, field by field, with its words.
  get problems(): TemplateProblems {
    return templateProblems(this.template, "schedule");
  }

  // Whether a schedule is being asked: no other is asked meanwhile.
  get busy(): boolean {
    return this.step.state === "asking" || this.step.state === "running";
  }

  // The name typed: a review shown is of another schedule, and goes with its token.
  type(name: string): void {
    this.name = name;
    this.changed();
  }

  // The expression typed, as it is typed.
  write(expression: string): void {
    this.wrapper = { ...this.wrapper, expression };
    this.changed();
  }

  // A flag chosen, true or false: the form always writes the three.
  flag(flag: ScheduleFlag, value: boolean): void {
    this.wrapper = { ...this.wrapper, [flag]: value };
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

  // The command of the list: a new form once the schedule of the form before was created. A form that is being filled,
  // or whose schedule was not created, is shown as it was left, and a schedule that is being created goes on. An end no
  // workspace showed is not lost with the form: the main process keeps it for the target bar (REQ-243).
  start(): void {
    if (this.step.state !== "created") return;
    this.step = { state: "form" };
    this.name = "";
    this.wrapper = NEW_WRAPPER;
    this.template = {};
  }

  // A workspace showed the end of the step: the main process is told, when the end is of a run and is its end.
  see(): void {
    const step = this.step;

    if (step.state === "created" && step.request) this.dependencies.shown?.(step.request);
    if (step.state === "failed" && step.request && !NOT_KNOWN.includes(step.failure.stage))
      this.dependencies.shown?.(step.request);
  }

  // The first gesture: the main process is asked for the review of the schedule, which it builds from the fields and
  // the locations it reads, and answers the text it will send. Nothing is created. What the form says is wrong of what
  // the cluster holds is given by the workspace, which reads it, and holds the review back as well.
  async review(blockers: readonly string[] = []): Promise<void> {
    const namespace = this.dependencies.namespace();
    const client = this.dependencies.client;
    const name = this.name;
    const wrapper = this.wrapper;
    const template = this.template;

    if (!namespace || !this.dependencies.writesOn() || this.nameProblem || blockers.length > 0) return;
    if (wrapper.expression === "" || this.expressionWords !== undefined) return;
    if (Object.keys(this.problems).length > 0) return;
    if (this.step.state !== "form" && this.step.state !== "failed") return;
    if (!client) {
      this.take({ state: "failed", failure: NO_WAY, left: "none", name });
      return;
    }
    const asking = this.take({ state: "asking" });
    const answer = await client.confirmScheduleCreate(this.dependencies.cluster(), namespace, name, wrapper, template);

    if (!this.at(asking)) return;
    if (!answer.ok) this.fail(answer, "none", name);
    else if (!answer.value.text || !readScheduleBody(answer.value.text))
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

  // The second gesture: the schedule is created with the token of its review, and read until Velero writes its phase,
  // or once when it is paused. A token that expired while the review was read is asked again once, and the run goes on
  // only when the main process answers the same text; another text is a new review, shown in place of the old one, and
  // nothing is sent (REQ-229).
  async create(): Promise<void> {
    const shown = this.step;
    const namespace = this.dependencies.namespace();
    const client = this.dependencies.client;
    const wrapper = this.wrapper;
    const template = this.template;

    if (shown.state !== "reviewing" || !namespace || !client || !this.dependencies.writesOn()) return;
    const running = this.take({
      state: "running",
      request: this.dependencies.requestId(),
      name: shown.name,
      paused: wrapper.paused,
    });
    let token = shown.token;

    if (this.dependencies.now() >= shown.expires) {
      const renewed = await client.confirmScheduleCreate(
        this.dependencies.cluster(),
        namespace,
        shown.name,
        wrapper,
        template,
      );

      if (!this.at(running)) return;
      if (!renewed.ok) {
        this.fail(renewed, "none", shown.name);
        return;
      }
      if (!renewed.value.text || !readScheduleBody(renewed.value.text)) {
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
    const answer = await client.runScheduleCreate(
      this.dependencies.cluster(),
      namespace,
      shown.name,
      token,
      running.request,
    );

    if (!this.at(running)) return;
    if (answer.ok) {
      this.take({ state: "created", schedule: answer.value, request: running.request });
      return;
    }
    // A name the API server answered with 409 is another schedule's: the form keeps what was typed, and the words lead
    // to that schedule (REQ-227).
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
    this.wrapper = NEW_WRAPPER;
    this.template = {};
  }

  // A field changed: what is shown is the form again, but for a schedule that is being created.
  private changed(): void {
    if (this.step.state !== "form" && this.step.state !== "running") this.step = { state: "form" };
  }

  private at(step: ScheduleCreateStep): boolean {
    return this.step === step;
  }

  private take<Step extends ScheduleCreateStep>(step: Step): Step {
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
