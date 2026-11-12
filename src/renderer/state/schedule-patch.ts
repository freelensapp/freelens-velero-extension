import { action, makeObservable, observable, observableRef, runInAction } from "mobx";
import { readSchedulePatch } from "../../common/schedule-patch";
import { type BackupLeft, backupLeft } from "./backup-now";

import type { Failure, ScheduleChanged } from "../../common/ipc";
import type { SchedulePatch as Patch } from "../../common/schedule-patch";
import type { PatchAction } from "../../common/schedule-patch-words";
import type { SchedulePatchClient } from "../api/ipc";

// The schedule a pause or a resume is asked of: its name, the UID the views read, which tells it from one created later
// with its name, and the expression the views read, which a resume tests.
export interface ScheduleOfPatch {
  name: string;
  uid: string;
  expression?: string;
}

// How a pause or a resume ended: applied, with the schedule as the main process read it after the patch; or not, with
// the words of the main process and whether the patch may have been applied all the same.
// The identifier of the request is the one of the run, which the main process keeps the end of for the cluster until
// a view showed it (REQ-250); a failure before the run has none.
export type SchedulePatchEnd =
  | { state: "done"; changed: ScheduleChanged; request: string }
  | { state: "failed"; failure: Failure; left: BackupLeft; request?: string };

// Where a pause or a resume is (SPEC-0017, REQ-274 to REQ-277): the form; the review asked of the main process; the
// review shown, with its token and the text it will send, and whether it took the place of one whose text changed; the
// patch sent and the schedule read after it; or its end.
export type SchedulePatchStep =
  | { state: "form" }
  | { state: "asking" }
  | { state: "reviewing"; token: string; expires: number; text: string; replaced?: true }
  | { state: "running"; request: string }
  | SchedulePatchEnd;

export interface SchedulePatchDependencies {
  client?: SchedulePatchClient;
  cluster(): string;
  namespace(): string | undefined;
  // Whether the main process last said that writes are on for the installation that is shown.
  writesOn(): boolean;
  now(): number;
  // The identifier of a new request.
  requestId(): string;
  // The main process refused, or the write did not end well: what it holds of the gate may not be what the views
  // show any more, and it is asked.
  refused(): void;
  // A view showed the end of a run: the main process keeps it no more.
  shown?(request: string): void;
}

const NO_WAY: Failure = {
  ok: false,
  code: "request-failed",
  stage: "way",
  retry: false,
  text: "The views have no way to the main process of the extension: the patch cannot be asked.",
};

// A review the views cannot show is not confirmed: the text of the patch is what the operator confirms, and it is the
// patch of what was asked, of this schedule, or it is no review.
const NO_TEXT: Failure = {
  ok: false,
  code: "validation",
  stage: "review",
  retry: false,
  text: "The main process answered no text of the patch that was asked that the review can show: nothing can be confirmed, and nothing was sent.",
};

// Where a write fails when it is not known what the main process did: its answer was lost on the way, was not one of
// the contract, or it raised while it answered.
const NOT_KNOWN = ["way", "answer", "handler"];

// A pause or a resume of a schedule, for the installation that is shown: one at a time, from the workspace of the
// schedule (SPEC-0017, REQ-274). The form keeps the choice of skipping a run while the review is shown and after a
// failure; a change of the choice drops the review and its token, as writes turned off do, and the installation that
// changes drops everything.
//
// What the main process answers is taken only by the step that asked it: a step that was left, because the operator
// went back, writes went off or the installation changed, takes nothing that arrives late. A patch that is being sent
// is not left: the main process says how it ended.
export class PauseResume {
  step: SchedulePatchStep = { state: "form" };
  // The action and the schedule the form is of, once a workspace asked for it.
  action?: PatchAction;
  schedule?: ScheduleOfPatch;
  // The choice of skipping the run that is due at a resume, which the form proposes as the schedule carries it.
  skip = false;
  private readonly dependencies: SchedulePatchDependencies;

  constructor(dependencies: SchedulePatchDependencies) {
    this.dependencies = dependencies;
    makeObservable(this, {
      step: observableRef,
      action: observable,
      schedule: observableRef,
      skip: observable,
      start: action,
      open: action,
      choose: action,
      see: action,
      leave: action,
      drop: action,
    });
  }

  // Whether a pause or a resume is being asked, of whatever schedule: no other is asked meanwhile.
  get busy(): boolean {
    return this.step.state === "asking" || this.step.state === "running";
  }

  // The command of the schedule: a new form of the action, with the choice of skipping a run as the schedule carries it,
  // true when it is true and false otherwise (REQ-275). A patch that is being sent goes on, and its workspace shows it.
  start(action: PatchAction, schedule: ScheduleOfPatch, carried: unknown): void {
    if (this.step.state === "running") return;
    this.action = action;
    this.schedule = schedule;
    this.skip = carried === true;
    this.step = { state: "form" };
  }

  // A workspace opened, by its command or by the address: the form of its action and its schedule, the one it shows
  // when it is of them already, and a new one when it is of another action, of another schedule, or of one of the same
  // name that was deleted since, or of an expression that changed.
  open(action: PatchAction, schedule: ScheduleOfPatch, carried: unknown): void {
    const ours = this.schedule;

    if (
      this.action === action &&
      ours?.name === schedule.name &&
      ours.uid === schedule.uid &&
      ours.expression === schedule.expression
    )
      return;
    this.start(action, schedule, carried);
  }

  // The choice of skipping a run: a review shown is of the other choice, and goes with its token; the words of a
  // failure and the result go too, since the form is what is shown again.
  choose(skip: boolean): void {
    this.skip = skip;
    if (this.step.state !== "form" && this.step.state !== "running") this.step = { state: "form" };
  }

  // A workspace showed the end of the step: the main process is told, when the end is of a run and is its end. A run
  // whose answer did not come back is not: the main process keeps how it ended, for the target bar.
  see(): void {
    const step = this.step;

    if (step.state === "done") this.dependencies.shown?.(step.request);
    if (step.state === "failed" && step.request && !NOT_KNOWN.includes(step.failure.stage))
      this.dependencies.shown?.(step.request);
  }

  // What a resume tests and writes beside the UID: the expression the views read, and the choice.
  private resume(): { expression: string; skipImmediately: boolean } | undefined {
    return this.action === "schedule-resume" && this.schedule?.expression
      ? { expression: this.schedule.expression, skipImmediately: this.skip }
      : undefined;
  }

  // Whether the text the main process answered is exactly the patch that was asked, of this schedule: the review shows
  // what will be sent, and nothing else is confirmed.
  private asked(text: string | undefined): boolean {
    const patch: Patch | undefined = text ? readSchedulePatch(text) : undefined;
    const resume = this.resume();

    if (!patch || patch.action !== this.action || patch.uid !== this.schedule?.uid) return false;
    return (
      patch.action === "schedule-pause" ||
      (resume !== undefined &&
        patch.expression === resume.expression &&
        patch.skipImmediately === resume.skipImmediately)
    );
  }

  // The first gesture: the main process is asked for the review of the patch, which it writes from what is asked and
  // answers as the text it will send. Nothing is sent.
  async review(): Promise<void> {
    const schedule = this.schedule;
    const action = this.action;
    const namespace = this.dependencies.namespace();
    const client = this.dependencies.client;
    const resume = this.resume();

    if (!schedule || !action || !namespace || !this.dependencies.writesOn()) return;
    if (action === "schedule-resume" && !resume) return;
    if (this.step.state !== "form" && this.step.state !== "failed") return;
    if (!client) {
      this.take({ state: "failed", failure: NO_WAY, left: "none" });
      return;
    }
    const asking = this.take({ state: "asking" });
    const answer = await client.confirmSchedulePatch(
      this.dependencies.cluster(),
      namespace,
      action,
      { name: schedule.name, uid: schedule.uid },
      resume,
    );

    if (!this.at(asking)) return;
    // A review sends nothing, however it failed.
    if (!answer.ok) this.fail(answer, "none");
    else if (!this.asked(answer.value.text)) this.take({ state: "failed", failure: NO_TEXT, left: "none" });
    else
      this.take({
        state: "reviewing",
        token: answer.value.token,
        expires: answer.value.expires,
        text: answer.value.text ?? "",
      });
  }

  // The second gesture: the patch is sent with the token of its review, and the schedule read once after it. The
  // gesture is what confirms: a token that expired while the review was read is asked again once, and the run goes on
  // only when the main process answers the same text; another text is a new review, shown in place of the old one, and
  // nothing is sent.
  async run(): Promise<void> {
    const shown = this.step;
    const schedule = this.schedule;
    const action = this.action;
    const namespace = this.dependencies.namespace();
    const client = this.dependencies.client;

    // Writes that are not on leave a review as soon as the views are told: the check is for a caller that was not.
    if (shown.state !== "reviewing" || !schedule || !action || !namespace || !client || !this.dependencies.writesOn())
      return;
    const running = this.take({ state: "running", request: this.dependencies.requestId() });
    const target = { name: schedule.name, uid: schedule.uid };
    let token = shown.token;

    if (this.dependencies.now() >= shown.expires) {
      const renewed = await client.confirmSchedulePatch(
        this.dependencies.cluster(),
        namespace,
        action,
        target,
        this.resume(),
      );

      if (!this.at(running)) return;
      if (!renewed.ok) {
        this.fail(renewed, "none");
        return;
      }
      if (!this.asked(renewed.value.text)) {
        this.take({ state: "failed", failure: NO_TEXT, left: "none" });
        return;
      }
      if (renewed.value.text !== shown.text) {
        this.take({
          state: "reviewing",
          token: renewed.value.token,
          expires: renewed.value.expires,
          text: renewed.value.text ?? "",
          replaced: true,
        });
        return;
      }
      token = renewed.value.token;
    }
    const answer = await client.runSchedulePatch(
      this.dependencies.cluster(),
      namespace,
      action,
      target,
      token,
      running.request,
    );

    if (!this.at(running)) return;
    if (answer.ok) this.take({ state: "done", changed: answer.value, request: running.request });
    else this.fail(answer, backupLeft(answer), running.request);
  }

  // A review is left without sending anything: by its command, with the workspace that shows it, or because writes
  // went off and the main process cleared it. One that is still asked is left as well, and its answer is not taken.
  leave(): void {
    if (this.step.state === "asking" || this.step.state === "reviewing") this.step = { state: "form" };
  }

  // The installation changed: the schedule and the choice were of the one before, and nothing that was asked for it is
  // taken.
  drop(): void {
    this.step = { state: "form" };
    this.action = undefined;
    this.schedule = undefined;
    this.skip = false;
  }

  // Whether the workspace is still at the step that asked: what is compared is the step itself, so that one that was
  // left and taken again, even to the same state, is another.
  private at(step: SchedulePatchStep): boolean {
    return this.step === step;
  }

  private take<Step extends SchedulePatchStep>(step: Step): Step {
    runInAction(() => {
      this.step = step;
    });
    return step;
  }

  private fail(failure: Failure, left: BackupLeft, request?: string): void {
    this.take({ state: "failed", failure, left, ...(request ? { request } : {}) });
    this.dependencies.refused();
  }
}
