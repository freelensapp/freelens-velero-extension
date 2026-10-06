import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { notTheText } from "../../common/artifact-text";
import { downloadFailure } from "../../common/diagnostic-text";
import { ARTIFACT_HOLD_MS, ARTIFACT_TEXT_BOUND, failure } from "../../common/ipc";

import type { ArtifactTarget, ArtifactValue, Failure, WriteTarget } from "../../common/ipc";
import type { ArtifactClient, WriteClient } from "../api/ipc";

// A text that was loaded, with how it came and when.
export interface ArtifactLoaded {
  state: "loaded";
  text: string;
  value: ArtifactValue;
  at: number;
}

// Where the load of an artifact is, in the tab that shows it: nothing asked; the confirmation asked of
// the main process; the confirmation shown, with its token; the request running, with the step the main
// process is at; the text loaded, with how it came; or ended without it, with the words of the main
// process, and when it ended. A confirmation that is asked for a tab that shows a text is asked over that
// text, which stays until the request is created: it is carried by the steps before that, and by a
// confirmation the main process refused.
export type ArtifactStep =
  | { state: "first" }
  | { state: "asking"; over?: ArtifactLoaded }
  | { state: "confirming"; token: string; expires: number; over?: ArtifactLoaded }
  | { state: "loading"; request: string; step: string; count?: number; pages?: number; cancelling?: boolean }
  | ArtifactLoaded
  | { state: "failed"; failure: Failure; at: number; over?: ArtifactLoaded };

// What the saving of the text a tab holds is at: nothing asked; the main process asked, which shows the
// dialog of the host; saved, into the file the operator chose there; left, when the operator closed the
// dialog and nothing was written; or failed, with the words of the main process.
export type ArtifactSaving =
  | { state: "none" }
  | { state: "asked" }
  | { state: "saved" }
  | { state: "left" }
  | { state: "failed"; failure: Failure };

export interface ArtifactLoadDependencies {
  client?: WriteClient & ArtifactClient;
  // The kind of request the tab asks for.
  artifact: ArtifactTarget;
  cluster(): string;
  namespace(): string | undefined;
  // The object the artifact is of, as the view has it: none while the view does not know it.
  target(): WriteTarget | undefined;
  // Whether the main process last said that writes are on for the installation that is shown.
  writesOn(): boolean;
  now(): number;
  // The identifier of a new request.
  requestId(): string;
  // The main process refused, or the load did not end well: what it holds of the gate may not be what
  // the views show any more, and it is asked.
  refused(): void;
}

const KIND = "DownloadRequest";
// How often the main process is asked where a load is, in milliseconds.
const POLL_MS = 250;

const NO_WAY: Failure = {
  ok: false,
  code: "request-failed",
  stage: "way",
  retry: false,
  text: "The views have no way to the main process of the extension: the request cannot be created.",
};

// One artifact of one operation, for as long as its view is open: asked for on purpose, confirmed, loaded
// by the main process and taken from it in pages, into the one copy this holds. Opening the tab asks
// nothing. What the main process answers is taken only by the load that asked it: one that was dropped,
// because the view closed, the installation changed or the tab loads again, takes nothing that arrives
// late, and what the main process held for it is let go.
export class ArtifactLoad {
  step: ArtifactStep = { state: "first" };
  // The request whose text the main process holds for this tab, while it does: the one that was loaded,
  // until the view lets it go or the main process does. It is what the command that saves the text names.
  held?: string;
  // Until when the main process holds that text, by the clock of the views: it lets a text go so long
  // after it held it, whatever the view does with it meanwhile. And whether that time has passed for the
  // text that is shown, which is then not offered to be saved.
  heldUntil?: number;
  expired = false;
  // What the saving of that text is at. It is of the text that is held, and goes with it.
  saving: ArtifactSaving = { state: "none" };
  private readonly dependencies: ArtifactLoadDependencies;
  // The run that is in flight, which a later one, or a drop, takes the place of.
  private run_ = 0;
  // What ends the offer to save the text when the main process holds it no more.
  private holding?: ReturnType<typeof setTimeout>;

  constructor(dependencies: ArtifactLoadDependencies) {
    this.dependencies = dependencies;
    makeObservable(this, {
      step: observable.ref,
      held: observable,
      heldUntil: observable,
      expired: observable,
      saving: observable.ref,
      savable: computed,
      shown: computed,
      leave: action,
      reset: action,
      drop: action,
    });
  }

  // Whether the command that saves is offered: for a text that is loaded and that the main process holds,
  // and not while the dialog of a saving is open.
  get savable(): boolean {
    return this.step.state === "loaded" && this.held !== undefined && this.saving.state !== "asked";
  }

  // The text the tab shows: the one that is loaded, and the one a confirmation is asked over, until the
  // request that takes its place is created.
  get shown(): ArtifactLoaded | undefined {
    const step = this.step;

    return step.state === "loaded"
      ? step
      : step.state === "asking" || step.state === "confirming" || step.state === "failed"
        ? step.over
        : undefined;
  }

  // The first gesture: the main process is asked for the confirmation of one DownloadRequest, of this
  // artifact of this object, and the views show the object it would create. Nothing is created, and
  // nothing goes: a text that was loaded before stays shown, and held, until the second gesture.
  async ask(): Promise<void> {
    const { client } = this.dependencies;
    const namespace = this.dependencies.namespace();
    const target = this.dependencies.target();

    if (!namespace || !target || !this.dependencies.writesOn()) return;
    if (this.step.state === "asking" || this.step.state === "confirming" || this.step.state === "loading") return;
    if (!client) {
      this.take({ state: "failed", failure: NO_WAY, at: this.dependencies.now() });
      return;
    }
    const over = this.shown;
    const kept = over ? { over } : {};
    const asking = this.take({ state: "asking", ...kept });
    const answer = await client.confirm(
      this.dependencies.cluster(),
      namespace,
      KIND,
      target,
      this.dependencies.artifact,
    );

    if (!this.at(asking)) return;
    if (answer.ok)
      this.take({ state: "confirming", token: answer.value.token, expires: answer.value.expires, ...kept });
    // A confirmation the main process refused created nothing: the text is still the one the tab holds.
    else this.fail(answer, over);
  }

  // The second gesture: the request is created with the token of its confirmation, and the main process
  // runs it. While it runs it is asked where it is; when it ends the text is taken page by page. The main
  // process keeps its copy, for the command that saves it, until the view lets it go or its time passes.
  async run(): Promise<void> {
    const shown = this.step;
    const { client } = this.dependencies;
    const namespace = this.dependencies.namespace();
    const target = this.dependencies.target();

    if (shown.state !== "confirming" || !namespace || !target || !client || !this.dependencies.writesOn()) return;
    const cluster = this.dependencies.cluster();
    const request = this.dependencies.requestId();
    const run = ++this.run_;
    const mine = () => this.run_ === run && this.step.state === "loading" && this.step.request === request;
    const show = (step: string, count?: number, pages?: number) => {
      if (!mine()) return;
      const cancelling = this.step.state === "loading" && this.step.cancelling;

      this.take({
        state: "loading",
        request,
        step,
        ...(count === undefined ? {} : { count }),
        ...(pages === undefined ? {} : { pages }),
        ...(cancelling ? { cancelling } : {}),
      });
    };

    // Whether the operator cancelled the load that runs.
    const cancelled = () => this.step.state === "loading" && this.step.cancelling === true;
    // The text the confirmation was shown over, which is held until the request is created.
    const over = shown.over;

    this.take({ state: "loading", request, step: "queue" });
    let token = shown.token;

    // The gesture is what confirms: a token that expired while the object was read is asked again once.
    if (this.dependencies.now() >= shown.expires) {
      const renewed = await client.confirm(cluster, namespace, KIND, target, this.dependencies.artifact);

      if (!mine()) return;
      if (!renewed.ok) {
        this.fail(renewed, over);
        return;
      }
      // The load was cancelled meanwhile: nothing was created, and nothing is. The tab is where it was.
      if (cancelled()) {
        this.take(over ?? { state: "first" });
        return;
      }
      token = renewed.value.token;
    }
    // A load that begins again is a new request: what was loaded before goes now, in both processes.
    this.letGo();
    const poll = setInterval(() => {
      void client.status(cluster, request).then((status) => {
        // The steps of the run are the ones that are shown: how it ended is what the run itself answers.
        if (status.ok && status.value.step !== "done" && !status.value.step.startsWith("failed"))
          show(status.value.step, status.value.count);
      });
    }, POLL_MS);
    let answer: Awaited<ReturnType<ArtifactClient["runDownload"]>>;

    try {
      answer = await client.runDownload(cluster, namespace, target, this.dependencies.artifact, token, request);
    } finally {
      clearInterval(poll);
    }
    if (!mine()) {
      // What the main process holds for a load that was dropped is let go.
      if (answer.ok) void client.release(cluster, request);
      return;
    }
    if (!answer.ok) {
      this.fail(answer);
      return;
    }
    // The main process holds the text from now, and for no longer than its time.
    const until = this.dependencies.now() + ARTIFACT_HOLD_MS;
    let text = "";

    // The load was cancelled while its pages were taken: the request was created and ran to its end, so
    // nothing is left to stop in the main process but the text it holds, which is let go. No more of it
    // is taken, and the load ends as one that was cancelled after its request was created.
    const stopped = (): boolean => {
      if (!cancelled()) return false;
      void client.release(cluster, request);
      this.fail(
        downloadFailure("cancelled", "delivery", {
          artifact: this.dependencies.artifact,
          name: target.name,
          namespace,
          request: answer.value.request.name,
        }),
      );
      return true;
    };

    for (let page = 0; page < answer.value.pages; page += 1) {
      if (stopped()) return;
      show("pages", page + 1, answer.value.pages);
      const taken = await client.page(cluster, request, page);

      if (!mine() || !taken.ok) {
        void client.release(cluster, request);
        if (mine() && !taken.ok) this.fail(taken);
        return;
      }
      text += taken.value.text;
      // The text is the one the load was answered of, page by page, and no more of it than an artifact
      // has: a page that is not the one that was asked, or of another count of pages, or a text past the
      // bound, ends the load with nothing shown. The views hold no more than the contract says they do.
      if (taken.value.page !== page || taken.value.pages !== answer.value.pages || text.length > ARTIFACT_TEXT_BOUND) {
        void client.release(cluster, request);
        this.fail(failure("artifact-invalid", "delivery", false, notTheText(answer.value.request.name, namespace)));
        return;
      }
    }
    if (stopped()) return;
    // The main process keeps its copy until the view lets it go, and for its time at most: one copy in
    // each process, and no more.
    const loaded: ArtifactStep = { state: "loaded", text, value: answer.value, at: this.dependencies.now() };

    runInAction(() => {
      this.held = request;
      this.heldUntil = until;
      this.expired = false;
      this.step = loaded;
    });
    this.holding = setTimeout(() => this.expire(request), Math.max(0, until - this.dependencies.now()));
  }

  // The time the main process holds a text for has passed: it let the text go by itself, and is asked
  // nothing. What was loaded stays shown, and is not offered to be saved.
  private expire(request: string): void {
    if (this.held !== request) return;
    runInAction(() => {
      this.held = undefined;
      this.expired = true;
    });
  }

  // The text that is held is saved into a file: the main process opens the dialog of the host, the operator
  // chooses the file there, and the main process writes its own copy of the text into it. Nothing of a file
  // is named here, and nothing is written to the cluster: it is no matter of the gate. One saving at a
  // time. What the main process answers is taken only by the saving that asked it: one whose load was
  // dropped, or began again, while the dialog was open says nothing of the text that is shown now.
  async save(): Promise<void> {
    const { client } = this.dependencies;
    const held = this.held;

    if (!this.savable || held === undefined || !client) return;
    const asked: ArtifactSaving = { state: "asked" };

    runInAction(() => {
      this.saving = asked;
    });
    const answer = await client.save(this.dependencies.cluster(), held);

    if (this.saving !== asked) return;
    runInAction(() => {
      if (answer.ok) {
        this.saving = { state: answer.value.saved ? "saved" : "left" };
        return;
      }
      // The main process holds the text no more: it let it go for the room of another before its time
      // passed. What was loaded stays shown, and is not offered to be saved again.
      if (answer.code === "not-found") this.held = undefined;
      this.saving = { state: "failed", failure: answer };
    });
  }

  // The load that runs is cancelled. The main process stops the request it runs, and answers how it
  // ended; a load whose confirmation is being renewed creates nothing, and one whose pages are being
  // taken takes no more: the run looks at this each time it goes on.
  async cancel(): Promise<void> {
    const { client } = this.dependencies;
    const shown = this.step;

    if (shown.state !== "loading" || shown.cancelling || !client) return;
    this.take({ ...shown, cancelling: true });
    await client.cancel(this.dependencies.cluster(), shown.request);
  }

  // A confirmation is left without creating anything: the tab is where it was before it was asked, with
  // the text it showed. A request that runs is not left: it is cancelled, or it ends.
  leave(): void {
    if (this.step.state === "asking" || this.step.state === "confirming")
      this.step = this.step.over ?? { state: "first" };
  }

  // A load that ended without its text is left behind: the tab is where it was before the request, at
  // its first state, or at the text it still shows when what failed was the confirmation of a load again.
  // Nothing is asked: it is the way on from a failure that is not to be asked again as it was asked.
  reset(): void {
    if (this.step.state === "failed") this.step = this.step.over ?? { state: "first" };
  }

  // The view closed, or the installation changed: what was loaded goes, a request that runs is
  // cancelled, and nothing that was asked is taken.
  drop(): void {
    const shown = this.step;

    this.run_ += 1;
    this.step = { state: "first" };
    if (shown.state === "loading") void this.dependencies.client?.cancel(this.dependencies.cluster(), shown.request);
    this.letGo();
  }

  // The text the main process holds for this tab is let go there, and what was said of its saving goes
  // with it: a saving that is still asked takes no answer.
  private letGo(): void {
    const held = this.held;

    clearTimeout(this.holding);
    runInAction(() => {
      this.held = undefined;
      this.heldUntil = undefined;
      this.expired = false;
      this.saving = { state: "none" };
    });
    if (held !== undefined) void this.dependencies.client?.release(this.dependencies.cluster(), held);
  }

  // Whether the tab is still at the step that asked: what is compared is the step itself, so that one
  // that was left and taken again, even to the same state, is another.
  private at(step: ArtifactStep): boolean {
    return this.step === step;
  }

  private take<Step extends ArtifactStep>(step: Step): Step {
    runInAction(() => {
      this.step = step;
    });
    return step;
  }

  private fail(ended: Failure, over?: ArtifactLoaded): void {
    this.take({ state: "failed", failure: ended, at: this.dependencies.now(), ...(over ? { over } : {}) });
    this.dependencies.refused();
  }
}
