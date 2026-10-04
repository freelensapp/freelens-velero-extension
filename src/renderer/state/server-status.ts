import { action, makeObservable, observable, runInAction } from "mobx";
import { current } from "../../common/discovery";

import type { Generation } from "../../common/discovery";
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

// What the server answered, with the time the views took it.
export interface ServerRead {
  value: ServerStatusValue;
  at: number;
}

export interface ServerStatusDependencies {
  client?: WriteClient;
  cluster(): string;
  namespace(): string | undefined;
  generation(): Generation;
  // Whether the main process last said that writes are on for the installation that is shown.
  writesOn(): boolean;
  now(): number;
  // The identifier of a new request.
  requestId(): string;
}

const NO_WAY: Failure = {
  ok: false,
  code: "request-failed",
  stage: "way",
  retry: false,
  text: "The views have no way to the main process of the extension: the request cannot be created.",
};

// The version of the server and its plugins, for the installation that is shown, for the session. It is
// read only when the operator asks and confirms, since a request is a write; what was read stays through
// the reads of the installation and the visits to other pages, and goes with the installation. An answer
// of an installation that is not the one shown any more is not taken.
export class ServerStatus {
  step: ServerStep = { state: "idle" };
  last?: ServerRead;
  private readonly dependencies: ServerStatusDependencies;

  constructor(dependencies: ServerStatusDependencies) {
    this.dependencies = dependencies;
    makeObservable(this, {
      step: observable.ref,
      last: observable.ref,
      back: action,
      drop: action,
    });
  }

  // The first gesture: the main process is asked for the confirmation of one ServerStatusRequest, which
  // has no target, and the views show the object it would create. Nothing is created.
  async ask(): Promise<void> {
    const asked = this.dependencies.generation();
    const namespace = this.dependencies.namespace();

    if (!namespace || !this.dependencies.writesOn()) return;
    if (this.step.state === "asking" || this.step.state === "running") return;
    runInAction(() => {
      this.step = { state: "asking" };
    });
    const answer = await this.confirmation(namespace);

    runInAction(() => {
      if (!current(this.dependencies.generation(), asked)) return;
      this.step = answer.ok
        ? { state: "confirming", token: answer.value.token, expires: answer.value.expires }
        : { state: "failed", failure: answer };
    });
  }

  // The second gesture: the request is created with the token of its confirmation, and waited for. A
  // confirmation that expired while it was shown is asked again once, for the same object.
  async run(): Promise<void> {
    const step = this.step;
    const asked = this.dependencies.generation();
    const namespace = this.dependencies.namespace();
    const client = this.dependencies.client;

    if (step.state !== "confirming" || !namespace || !this.dependencies.writesOn()) return;
    if (!client) {
      runInAction(() => {
        this.step = { state: "failed", failure: NO_WAY };
      });
      return;
    }
    runInAction(() => {
      this.step = { state: "running" };
    });
    let token = step.token;

    if (this.dependencies.now() >= step.expires) {
      const renewed = await this.confirmation(namespace);

      if (!current(this.dependencies.generation(), asked)) return;
      if (!renewed.ok) {
        runInAction(() => {
          this.step = { state: "failed", failure: renewed };
        });
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

    runInAction(() => {
      if (!current(this.dependencies.generation(), asked)) return;
      if (answer.ok) {
        this.last = { value: answer.value, at: this.dependencies.now() };
        this.step = { state: "idle" };
      } else {
        this.step = { state: "failed", failure: answer };
      }
    });
  }

  // The operator leaves the confirmation, or what ended, without creating anything.
  back(): void {
    if (this.step.state === "confirming" || this.step.state === "failed") this.step = { state: "idle" };
  }

  // The installation changed: what was read of the one before is not of this one.
  drop(): void {
    this.step = { state: "idle" };
    this.last = undefined;
  }

  private confirmation(namespace: string) {
    const client = this.dependencies.client;

    if (!client) return Promise.resolve(NO_WAY);
    return client.confirm(this.dependencies.cluster(), namespace, "ServerStatusRequest");
  }
}
