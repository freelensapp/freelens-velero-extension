import { action, computed, makeObservable, observable, observableRef, runInAction } from "mobx";
import { backupNameProblem, proposedBackupName, scheduleRefused } from "../../common/backup-from-schedule";

import type { BackupCreated, Failure } from "../../common/ipc";
import type { BackupNowClient } from "../api/ipc";

// The schedule a backup is asked from: its name, and the UID the views read, which tells it from one created later
// with its name.
export interface ScheduleOfBackup {
  name: string;
  uid: string;
}

// Whether a backup that failed may be there: not, or it is not known, when the answer of its creation was lost or the
// main process could not be asked. The words of the main process say what the reads after it found.
export type BackupLeft = "none" | "unknown";

// Where a backup asked from a schedule is (SPEC-0017, REQ-252): the form, with its name; the review asked of the main
// process; the review shown, with its token and the text it will send; the backup created and read; created, with
// what Velero wrote of it; or ended without a backup, with the words of the main process, the name that was asked and
// whether it may be there.
export type BackupNowStep =
  | { state: "form" }
  | { state: "asking" }
  | { state: "reviewing"; token: string; expires: number; text: string; name: string }
  | { state: "running"; request: string; name: string }
  | { state: "created"; backup: BackupCreated }
  | { state: "failed"; failure: Failure; left: BackupLeft; name: string };

export interface BackupNowDependencies {
  client?: BackupNowClient;
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
}

const NO_WAY: Failure = {
  ok: false,
  code: "request-failed",
  stage: "way",
  retry: false,
  text: "The views have no way to the main process of the extension: the backup cannot be asked.",
};

// Where a write fails when it is not known what the main process did: its answer was lost on the way, was not one of
// the contract, or it raised while it answered.
const NOT_KNOWN = ["way", "answer", "handler"];

// Whether a backup that failed may be there. A creation whose answer was lost is looked for by the main process, and
// its words say what was found; a run whose answer the views did not get may have created it. Every other end is
// one where nothing was sent, or where the API server refused it.
export function backupLeft(failure: Failure): BackupLeft {
  return failure.code === "submission-unknown" || NOT_KNOWN.includes(failure.stage) ? "unknown" : "none";
}

// A backup asked from a schedule by hand, for the installation that is shown: one at a time, from the workspace of the
// schedule (SPEC-0017, REQ-249). The form keeps its name while the review is shown and after a failure; a change of the
// name drops the review and its token, as writes turned off do, and the installation that changes drops everything.
//
// What the main process answers is taken only by the step that asked it: a step that was left, because the operator
// went back, writes went off or the installation changed, takes nothing that arrives late. A backup that is being
// created is not left: the main process says how it ended.
export class BackupNow {
  step: BackupNowStep = { state: "form" };
  // The schedule the form is of, once a workspace asked for it.
  schedule?: ScheduleOfBackup;
  // The name of the backup, as it is in the field.
  name = "";
  // The name the form proposed, which Escape in the field gives back.
  proposed = "";
  private readonly dependencies: BackupNowDependencies;

  constructor(dependencies: BackupNowDependencies) {
    this.dependencies = dependencies;
    makeObservable(this, {
      step: observableRef,
      schedule: observableRef,
      name: observable,
      proposed: observable,
      problem: computed,
      refused: computed,
      start: action,
      open: action,
      type: action,
      leave: action,
      drop: action,
    });
  }

  // What is wrong with the name in words, as the main process checks it again.
  get problem(): string | undefined {
    return backupNameProblem(this.name);
  }

  // Why the schedule cannot be asked for a backup, in words.
  get refused(): string | undefined {
    return this.schedule ? scheduleRefused(this.schedule.name) : undefined;
  }

  // Whether a backup is being asked, from whatever schedule: no other is asked meanwhile.
  get busy(): boolean {
    return this.step.state === "asking" || this.step.state === "running";
  }

  // The command of the schedule: a new form, with the name the command line proposes now. A backup that is being
  // created goes on, and its workspace shows it.
  start(schedule: ScheduleOfBackup): void {
    if (this.step.state === "running") return;
    const proposed = proposedBackupName(schedule.name, this.dependencies.now());

    this.schedule = schedule;
    this.name = proposed;
    this.proposed = proposed;
    this.step = { state: "form" };
  }

  // A workspace opened, by its command or by the address: the form of its schedule, the one it shows when it is of
  // that schedule already, and a new one when it is of another, or of one of the same name that was deleted since.
  open(schedule: ScheduleOfBackup): void {
    if (this.schedule?.name === schedule.name && this.schedule.uid === schedule.uid) return;
    this.start(schedule);
  }

  // The name typed: a review shown is of another name, and goes with its token; the words of a failure and the result
  // go too, since the form is what is shown again.
  type(name: string): void {
    this.name = name;
    if (this.step.state !== "form" && this.step.state !== "running") this.step = { state: "form" };
  }

  // The first gesture: the main process is asked for the review of the backup, which it builds from the schedule as
  // it reads it, and answers the text it will send. Nothing is created.
  async review(): Promise<void> {
    const schedule = this.schedule;
    const namespace = this.dependencies.namespace();
    const client = this.dependencies.client;
    const name = this.name;

    if (!schedule || !namespace || !this.dependencies.writesOn() || this.problem || this.refused) return;
    if (this.step.state !== "form" && this.step.state !== "failed") return;
    if (!client) {
      this.take({ state: "failed", failure: NO_WAY, left: "none", name });
      return;
    }
    const asking = this.take({ state: "asking" });
    const answer = await client.confirmBackupNow(this.dependencies.cluster(), namespace, schedule, name);

    if (!this.at(asking)) return;
    if (answer.ok)
      this.take({
        state: "reviewing",
        token: answer.value.token,
        expires: answer.value.expires,
        text: answer.value.text ?? "",
        name,
      });
    // A review creates nothing, however it failed.
    else this.fail(answer, "none", name);
  }

  // The second gesture: the backup is created with the token of its review, and read until Velero writes its phase.
  // The gesture is what confirms: a token that expired while the review was read is asked again once, and the run
  // goes on only when the main process answers the same text; another text is a new review, shown in place of the
  // old one, and nothing is sent.
  async create(): Promise<void> {
    const shown = this.step;
    const schedule = this.schedule;
    const namespace = this.dependencies.namespace();
    const client = this.dependencies.client;

    // Writes that are not on leave a review as soon as the views are told: the check is for a caller that was not.
    if (shown.state !== "reviewing" || !schedule || !namespace || !client || !this.dependencies.writesOn()) return;
    const running = this.take({ state: "running", request: this.dependencies.requestId(), name: shown.name });
    let token = shown.token;

    if (this.dependencies.now() >= shown.expires) {
      const renewed = await client.confirmBackupNow(this.dependencies.cluster(), namespace, schedule, shown.name);

      if (!this.at(running)) return;
      if (!renewed.ok) {
        this.fail(renewed, "none", shown.name);
        return;
      }
      if (renewed.value.text !== shown.text) {
        this.take({
          state: "reviewing",
          token: renewed.value.token,
          expires: renewed.value.expires,
          text: renewed.value.text ?? "",
          name: shown.name,
        });
        return;
      }
      token = renewed.value.token;
    }
    const answer = await client.runBackupNow(
      this.dependencies.cluster(),
      namespace,
      schedule,
      shown.name,
      token,
      running.request,
    );

    if (!this.at(running)) return;
    if (answer.ok) {
      this.take({ state: "created", backup: answer.value });
      return;
    }
    // A name the API server answered with 409 is another backup's: the form proposes the name of the next second
    // (SPEC-0017, REQ-258).
    if (answer.code === "conflict" && answer.stage === "creation") {
      runInAction(() => {
        const now = this.dependencies.now();
        let next = proposedBackupName(schedule.name, now);

        if (next === shown.name) next = proposedBackupName(schedule.name, now + 1000);
        this.name = next;
        this.proposed = next;
      });
    }
    this.fail(answer, backupLeft(answer), shown.name);
  }

  // A review is left without creating anything: by its command, with the workspace that shows it, or because writes
  // went off and the main process cleared it. One that is still asked is left as well, and its answer is not taken.
  leave(): void {
    if (this.step.state === "asking" || this.step.state === "reviewing") this.step = { state: "form" };
  }

  // The installation changed: the schedule and the name were of the one before, and nothing that was asked for it is
  // taken.
  drop(): void {
    this.step = { state: "form" };
    this.schedule = undefined;
    this.name = "";
    this.proposed = "";
  }

  // Whether the workspace is still at the step that asked: what is compared is the step itself, so that one that was
  // left and taken again, even to the same state, is another.
  private at(step: BackupNowStep): boolean {
    return this.step === step;
  }

  private take<Step extends BackupNowStep>(step: Step): Step {
    runInAction(() => {
      this.step = step;
    });
    return step;
  }

  private fail(failure: Failure, left: BackupLeft, name: string): void {
    this.take({ state: "failed", failure, left, name });
    this.dependencies.refused();
  }
}
