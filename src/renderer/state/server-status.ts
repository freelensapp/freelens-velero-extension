import { action, makeObservable, observable, runInAction } from "mobx";
import { REQUEST_STAGES } from "../../common/ipc";

import type { Failure, ServerStatusValue } from "../../common/ipc";
import type { WriteClient } from "../api/ipc";

// What a write that failed left in the cluster, as far as its failure says: nothing, the request, or it
// is not known.
export type RequestLeft = "none" | "created" | "unknown";

// Where the request of the version of the server is: not asked; the confirmation asked of the main
// process; the confirmation shown, with its token; the request created and waited for; or ended without
// an answer, with the words of the main process and what is known of the request.
export type ServerStep =
  | { state: "idle" }
  | { state: "asking" }
  | { state: "confirming"; token: string; expires: number }
  | { state: "running" }
  | { state: "failed"; failure: Failure; request: RequestLeft };

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

// The failures of the creation after which nothing is in the cluster: the cluster refused it, or it was
// not sent. Every other failure at that stage is one whose answer was lost, or that was stopped while the
// cluster was asked.
const NOT_CREATED = [
  "forbidden",
  "deadline",
  "transport-unreachable",
  "tls-invalid",
  "not-found",
  "conflict",
  "validation",
];
// Where a run fails when it is not known what the main process did: its answer was lost on the way, was
// not one of the contract, or it raised while it answered.
const NOT_KNOWN = ["way", "answer", "handler"];

// What a run that failed left in the cluster. A request that was waited for is there. One whose creation
// the cluster refused, or that the main process refused before asking the cluster, is not. Of the others
// it is not known: the operator is told to look before asking again.
export function requestLeft(failure: Failure): RequestLeft {
  if (failure.stage === REQUEST_STAGES.wait) return "created";
  if (failure.stage === REQUEST_STAGES.creation) return NOT_CREATED.includes(failure.code) ? "none" : "unknown";
  return NOT_KNOWN.includes(failure.stage) ? "unknown" : "none";
}

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
      leave: action,
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
      this.take({ state: "failed", failure: NO_WAY, request: "none" });
      return;
    }
    const asking = this.take({ state: "asking" });
    const answer = await client.confirm(this.dependencies.cluster(), namespace, KIND);

    if (!this.at(asking)) return;
    if (answer.ok) this.take({ state: "confirming", token: answer.value.token, expires: answer.value.expires });
    // A confirmation creates nothing, however it failed.
    else this.fail(answer, "none");
  }

  // The second gesture: the request is created with the token of its confirmation, and waited for. The
  // gesture is what confirms: a token that expired while the object was read is asked again once, for
  // the same object, and the operator is not sent back for the time the reading took.
  async run(): Promise<void> {
    const shown = this.step;
    const namespace = this.dependencies.namespace();
    const client = this.dependencies.client;

    // Writes that are not on leave a confirmation as soon as the views are told: the check is for a
    // caller that was not.
    if (shown.state !== "confirming" || !namespace || !client || !this.dependencies.writesOn()) return;
    const running = this.take({ state: "running" });
    let token = shown.token;

    if (this.dependencies.now() >= shown.expires) {
      const renewed = await client.confirm(this.dependencies.cluster(), namespace, KIND);

      if (!this.at(running)) return;
      if (!renewed.ok) {
        this.fail(renewed, "none");
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
      this.fail(answer, requestLeft(answer));
      return;
    }
    runInAction(() => {
      this.last = answer.value;
      this.step = { state: "idle" };
    });
  }

  // A confirmation is left without creating anything: by its command, with the page that shows it, or
  // because writes went off and the main process cleared it. One that is still asked is left as well,
  // and its answer is not taken. A request that runs is not left: the main process says how it ended,
  // and what was read and the words of a request that failed stay.
  leave(): void {
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

  private fail(failure: Failure, request: RequestLeft): void {
    this.take({ state: "failed", failure, request });
    this.dependencies.refused();
  }
}
