import { action, computed, makeObservable, observable, observableRef, runInAction } from "mobx";
import { deleteRequestOf, deleteRequestText } from "../../common/delete-request";
import { type BackupLeft, backupLeft } from "./backup-now";

import type { BackupDeleted, Failure, WriteTarget } from "../../common/ipc";
import type { BackupDeleteClient } from "../api/ipc";

// How a deletion ended: its request created, with what the reads after it showed of the request and of the backup; or
// without a request, with the words of the main process and whether one may have been created. The identifier of the
// request is the one of the run, which the main process keeps the end of for the cluster until a view showed it
// (REQ-250).
export type BackupDeleteEnd =
  | { state: "done"; deleted: BackupDeleted; request: string; backup: WriteTarget }
  | { state: "failed"; failure: Failure; left: BackupLeft; request?: string };

// Where a deletion is: the workspace of the backup; the review asked of the main process; the review shown, with its
// token, the text it will send and the other requests of the backup; the request created and read; or its end.
export type BackupDeleteStep =
  | { state: "form" }
  | { state: "asking" }
  | {
      state: "reviewing";
      token: string;
      expires: number;
      text: string;
      backup: WriteTarget;
      others?: number;
    }
  | { state: "running"; request: string; backup: WriteTarget }
  | BackupDeleteEnd;

export interface BackupDeleteDependencies {
  client?: BackupDeleteClient;
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
  text: "The views have no way to the main process of the extension: the deletion cannot be asked.",
};

// A review the views cannot show is not confirmed: the text of the request is what the operator confirms, and it is the
// request of this backup and of no other.
const NO_TEXT: Failure = {
  ok: false,
  code: "validation",
  stage: "review",
  retry: false,
  text: "The main process answered no text of the request to delete this backup that the review can show: nothing can be confirmed, and nothing was created.",
};

// Where a write fails when it is not known what the main process did.
const NOT_KNOWN = ["way", "answer", "handler"];

// The deletion of one backup, for the installation that is shown: one at a time, and of one backup (SPEC-0017, REQ-249,
// REQ-278 to REQ-284). The review is asked of the main process, which reads the backup again and writes the request;
// the name of the backup typed in the review is the second gesture of REQ-281, which the main process compares again.
// Writes turned off drop a review and its token, and the installation that changes drops everything. What the main
// process answers is taken only by the step that asked it.
export class BackupDelete {
  step: BackupDeleteStep = { state: "form" };
  // The backup the deletion is of.
  backup: WriteTarget | undefined = undefined;
  // The name of the backup as it is typed in the review.
  typed = "";
  private readonly dependencies: BackupDeleteDependencies;

  constructor(dependencies: BackupDeleteDependencies) {
    this.dependencies = dependencies;
    makeObservable(this, {
      step: observableRef,
      backup: observableRef,
      typed: observable,
      confirmed: computed,
      start: action,
      typeBackup: action,
      see: action,
      leave: action,
      drop: action,
    });
  }

  // Whether the name of the backup is typed as it is written, which the command that deletes waits for (REQ-281).
  get confirmed(): boolean {
    return this.step.state === "reviewing" && this.typed === this.step.backup.name;
  }

  // Whether a deletion is being asked: no other is asked meanwhile.
  get busy(): boolean {
    return this.step.state === "asking" || this.step.state === "running";
  }

  // The command of the view of a backup: the workspace of its deletion. The same backup keeps what it showed, but a
  // review, which a view asks again; another backup, or one created again under its name, gives a new workspace. A
  // deletion that is being asked goes on. An end no workspace showed is not lost: the main process keeps it for the
  // target bar (REQ-250).
  start(backup: WriteTarget): void {
    if (this.busy) return;
    const same = this.backup?.name === backup.name && this.backup.uid === backup.uid;

    if (same && this.step.state !== "done") {
      if (this.step.state === "reviewing") this.step = { state: "form" };
      return;
    }
    this.step = { state: "form" };
    this.backup = { kind: "Backup", name: backup.name, uid: backup.uid };
    this.typed = "";
  }

  // The name of the backup typed in the review, the second gesture: it drops nothing.
  typeBackup(typed: string): void {
    this.typed = typed;
  }

  // A workspace showed the end of the step: the main process is told, when the end is of a run and is its end.
  see(): void {
    const step = this.step;

    if (step.state === "done") this.dependencies.shown?.(step.request);
    if (step.state === "failed" && step.request && !NOT_KNOWN.includes(step.failure.stage))
      this.dependencies.shown?.(step.request);
  }

  // The first gesture: the main process is asked for the review of the deletion, which it builds from the backup it
  // reads again, and answers the text it will send. Nothing is created.
  async review(): Promise<void> {
    const namespace = this.dependencies.namespace();
    const client = this.dependencies.client;
    const backup = this.backup;

    if (!namespace || !backup || !this.dependencies.writesOn()) return;
    if (this.step.state !== "form" && this.step.state !== "failed") return;
    if (!client) {
      this.take({ state: "failed", failure: NO_WAY, left: "none" });
      return;
    }
    const asking = this.take({ state: "asking" });
    const answer = await client.confirmBackupDelete(this.dependencies.cluster(), namespace, backup);

    if (!this.at(asking)) return;
    if (!answer.ok) this.fail(answer, "none");
    else if (!this.asked(answer.value.text, namespace, backup))
      this.take({ state: "failed", failure: NO_TEXT, left: "none" });
    else {
      this.typed = "";
      this.take({
        state: "reviewing",
        token: answer.value.token,
        expires: answer.value.expires,
        text: answer.value.text as string,
        backup,
        ...(answer.value.others === undefined ? {} : { others: answer.value.others }),
      });
    }
  }

  // The second gesture done, the request is created with the token of its review, and read with the backup until what
  // they show is an end. A token that expired while the review was read is asked again once, and the run goes on with
  // the text of the request of the same backup, which is the text of the review: the request is written from the
  // namespace and the backup alone.
  async run(): Promise<void> {
    const shown = this.step;
    const namespace = this.dependencies.namespace();
    const client = this.dependencies.client;
    const typed = this.typed;

    if (shown.state !== "reviewing" || !namespace || !client || !this.dependencies.writesOn()) return;
    if (typed !== shown.backup.name) return;
    const running = this.take({ state: "running", request: this.dependencies.requestId(), backup: shown.backup });
    let token = shown.token;

    if (this.dependencies.now() >= shown.expires) {
      const renewed = await client.confirmBackupDelete(this.dependencies.cluster(), namespace, shown.backup);

      if (!this.at(running)) return;
      if (!renewed.ok) {
        this.fail(renewed, "none");
        return;
      }
      if (renewed.value.text !== shown.text || !this.asked(renewed.value.text, namespace, shown.backup)) {
        this.take({ state: "failed", failure: NO_TEXT, left: "none" });
        return;
      }
      token = renewed.value.token;
    }
    const answer = await client.runBackupDelete(
      this.dependencies.cluster(),
      namespace,
      shown.backup,
      typed,
      token,
      running.request,
    );

    if (!this.at(running)) return;
    if (answer.ok) {
      this.take({ state: "done", deleted: answer.value, request: running.request, backup: shown.backup });
      return;
    }
    this.fail(answer, backupLeft(answer), running.request);
  }

  // A review is left without creating anything: by its command, with the workspace that shows it, or because writes
  // went off. One that is still asked is left as well, and its answer is not taken.
  leave(): void {
    if (this.step.state === "asking" || this.step.state === "reviewing") this.step = { state: "form" };
  }

  // The installation changed: nothing that was asked for the one before is taken.
  drop(): void {
    this.step = { state: "form" };
    this.backup = undefined;
    this.typed = "";
  }

  // Whether a text is exactly the request of this backup, in this namespace, as the main process writes it.
  private asked(text: string | undefined, namespace: string, backup: WriteTarget): boolean {
    return text !== undefined && text === deleteRequestText(deleteRequestOf(namespace, backup));
  }

  private at(step: BackupDeleteStep): boolean {
    return this.step === step;
  }

  private take<Step extends BackupDeleteStep>(step: Step): Step {
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
