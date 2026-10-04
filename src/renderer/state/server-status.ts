import { action, makeObservable, observable, runInAction } from "mobx";

import type { Failure, ServerStatusValue } from "../../common/ipc";
import type { WriteClient } from "../api/ipc";

// Where the request of the version of the server is: not asked; the confirmation asked of the main
// process; the confirmation shown, with its token; the request created and waited for; or ended without
// an answer, with the words of the main process.
export type ServerStep =
  | { state: "idle" }
  | { state: "asking" }
  | { state: "confirming"; token: string; expires: number }
  | { state: "running" }
  | { state: "failed"; failure: Failure };

export interface ServerStatusDependencies {
  client?: WriteClient;
  cluster(): string;
  namespace(): string | undefined;
  // Whether the main process last said that writes are on for the installation that is shown.
  writesOn(): boolean;
  now(): number;
  // The identifier of a new request.
  requestId(): string;
  // The main process refused, or the write did not end well: what it holds of the gate may not be what
  // the views show any more, and it is asked.
  refused(): void;
}

const KIND = "ServerStatusRequest";

const NO_WAY: Failure = {
  ok: false,
  code: "request-failed",
  stage: "way",
  retry: false,
  text: "The views have no way to the main process of the extension: the request cannot be created.",
};

// The version of the server and its plugins, for the installation that is shown, for the session. It is
// read only when the operator asks and confirms, since a request is a write; what was read stays through
// the reads of the installation and the visits to other pages, and goes with the installation.
//
// What the main process answers is taken only by the step that asked it: a step that was left, because
// the operator went back, writes went off or the installation changed, takes nothing that arrives late.
export class ServerStatus {
  step: ServerStep = { state: "idle" };
  // What the server last answered for this installation.
  last?: ServerStatusValue;
  private readonly dependencies: ServerStatusDependencies;

  constructor(dependencies: ServerStatusDependencies) {
    this.dependencies = dependencies;
    makeObservable(this, {
      step: observable.ref,
      last: observable.ref,
      back: action,
      off: action,
      drop: action,
    });
  }

  // The first gesture: the main process is asked for the confirmation of one ServerStatusRequest, which
  // has no target, and the views show the object it would create. Nothing is created.
  async ask(): Promise<void> {
    const namespace = this.dependencies.namespace();
    const client = this.dependencies.client;

    if (!namespace || !this.dependencies.writesOn()) return;
    if (this.step.state === "asking" || this.step.state === "confirming" || this.step.state === "running") return;
    if (!client) {
      this.take({ state: "failed", failure: NO_WAY });
      return;
    }
    const asking = this.take({ state: "asking" });
    const answer = await client.confirm(this.dependencies.cluster(), namespace, KIND);

    if (!this.at(asking)) return;
    if (answer.ok) this.take({ state: "confirming", token: answer.value.token, expires: answer.value.expires });
    else this.fail(answer);
  }

  // The second gesture: the request is created with the token of its confirmation, and waited for. A
  // confirmation that expired while it was shown is asked again once, for the same object.
  async run(): Promise<void> {
    const shown = this.step;
    const namespace = this.dependencies.namespace();
    const client = this.dependencies.client;

    if (shown.state !== "confirming" || !namespace || !client || !this.dependencies.writesOn()) return;
    const running = this.take({ state: "running" });
    let token = shown.token;

    if (this.dependencies.now() >= shown.expires) {
      const renewed = await client.confirm(this.dependencies.cluster(), namespace, KIND);

      if (!this.at(running)) return;
      if (!renewed.ok) {
        this.fail(renewed);
        return;
      }
      token = renewed.value.token;
    }
    const answer = await client.runServerStatus(
      this.dependencies.cluster(),
      namespace,
      token,
      this.dependencies.requestId(),
    );

    if (!this.at(running)) return;
    if (!answer.ok) {
      this.fail(answer);
      return;
    }
    runInAction(() => {
      this.last = answer.value;
      this.step = { state: "idle" };
    });
  }

  // The operator leaves the confirmation without creating anything: by its command, or by leaving the page
  // that shows it. What was read, a request that runs and the words of one that failed stay.
  back(): void {
    if (this.step.state === "confirming") this.step = { state: "idle" };
  }

  // Writes went off: the main process cleared the confirmations, and the one that is shown, or asked,
  // is of no use. A request that runs is aborted by the main process, which says how it ended.
  off(): void {
    if (this.step.state === "asking" || this.step.state === "confirming") this.step = { state: "idle" };
  }

  // The installation changed: what was read of the one before is not of this one, and nothing that was
  // asked for it is taken.
  drop(): void {
    this.step = { state: "idle" };
    this.last = undefined;
  }

  // Whether the band is still at the step that asked: what is compared is the step itself, so that one
  // that was left and taken again, even to the same state, is another.
  private at(step: ServerStep): boolean {
    return this.step === step;
  }

  private take<Step extends ServerStep>(step: Step): Step {
    runInAction(() => {
      this.step = step;
    });
    return step;
  }

  private fail(failure: Failure): void {
    this.take({ state: "failed", failure });
    this.dependencies.refused();
  }
}
