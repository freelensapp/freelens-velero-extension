import { runInAction } from "mobx";
import { artifactOf } from "../../common/artifact-text";
import { ArtifactLoad } from "./artifact-load";

import type { ArtifactTab } from "../../common/artifact-text";
import type { OperationKind } from "../../common/phases";
import type { ObjectMetadata } from "../../common/types";
import type { ArtifactClient, WriteClient } from "../api/ipc";

export interface ArtifactLoadsDependencies {
  client?: WriteClient & ArtifactClient;
  cluster(): string;
  namespace(): string | undefined;
  // The backup or the restore of that name, as the installation last read it: none while it is not known.
  object(kind: OperationKind, name: string): { metadata: ObjectMetadata } | undefined;
  // Whether the main process last said that writes are on for the installation that is shown.
  writesOn(): boolean;
  now(): number;
  // The identifier of a new request.
  requestId(): string;
  // The main process refused, or a load did not end well: what it holds of the gate is asked.
  refused(): void;
}

// The loads of the tabs of the view that is open: one for each artifact of the backup or the restore that
// is shown, made when its tab first asks for it and the same one for as long as the view is open. One view
// is shown at a time, so that four texts are held at most. They are dropped, with what the main process
// holds for them, when the view closes, when the view of another operation opens, and when the
// installation changes; a confirmation that waits is left when writes are no longer on. Making a load asks
// nothing: an artifact is asked for by the command of its tab.
export class ArtifactLoads {
  private readonly dependencies: ArtifactLoadsDependencies;
  // The loads of each operation, by its kind and its name, then by their tab.
  private readonly held = new Map<string, Map<ArtifactTab, ArtifactLoad>>();
  // The view that is open, which only its own closing closes.
  private shown?: { of: string };

  constructor(dependencies: ArtifactLoadsDependencies) {
    this.dependencies = dependencies;
  }

  // The load of one tab of one operation. Its target is the object as the installation last read it, read
  // again each time it is asked: an object that is not known, or carries no UID, is asked nothing.
  load(kind: OperationKind, name: string, tab: ArtifactTab): ArtifactLoad {
    const { client, cluster, namespace, writesOn, now, requestId, refused } = this.dependencies;
    const of = `${kind}/${name}`;
    const tabs = this.held.get(of) ?? new Map<ArtifactTab, ArtifactLoad>();
    const load =
      tabs.get(tab) ??
      new ArtifactLoad({
        client,
        artifact: artifactOf(tab, kind),
        cluster,
        namespace,
        target: () => {
          const uid = this.dependencies.object(kind, name)?.metadata.uid;

          return uid ? { kind, name, uid } : undefined;
        },
        writesOn,
        now,
        requestId,
        refused,
      });

    this.held.set(of, tabs.set(tab, load));
    return load;
  }

  // The view of an operation opened: what is held of any other goes. It answers what the view calls when
  // it closes, which drops the loads of the operation unless its view opened again since.
  open(kind: OperationKind, name: string): () => void {
    const shown = { of: `${kind}/${name}` };

    this.shown = shown;
    this.dropAll((of) => of !== shown.of);
    return () => {
      if (this.shown !== shown) return;
      this.shown = undefined;
      this.dropAll((of) => of === shown.of);
    };
  }

  // Writes are not on any more: a confirmation that waits, waits for nothing. What was loaded stays, and a
  // request that runs is not left.
  leave(): void {
    runInAction(() => {
      for (const tabs of this.held.values()) for (const load of tabs.values()) load.leave();
    });
  }

  // The installation changed: nothing that was loaded of the one before is of this one.
  drop(): void {
    this.dropAll(() => true);
  }

  private dropAll(which: (of: string) => boolean): void {
    runInAction(() => {
      for (const [of, tabs] of [...this.held]) {
        if (!which(of)) continue;
        for (const load of tabs.values()) load.drop();
        this.held.delete(of);
      }
    });
  }
}
