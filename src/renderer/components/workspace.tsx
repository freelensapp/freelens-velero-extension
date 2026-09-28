import { Renderer } from "@freelensapp/extensions";
import React from "react";
import { operationState } from "../../common/phases";
import { VIEWS } from "../../common/views";
import { openView } from "../navigation";
import styles from "./views.module.css";

import type { ReactNode } from "react";

import type { FamilyRead } from "../../common/read-state";
import type { Reference, ReferenceKind, RelatedRestores } from "../../common/references";
import type { RestoreResource } from "../../common/types";
import type { ViewKind, ViewTarget } from "../../common/views";

const {
  Component: { Icon, Spinner },
} = Renderer;

// The kinds of Velero that have a view of their own: a reference to one of them that resolves leads there.
const VIEW_OF: Partial<Record<ReferenceKind, ViewKind>> = {
  Backup: "backup",
  Restore: "restore",
};

export function Fact({ name, note, children }: { name: string; note?: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <div className={styles.factName}>{name}</div>
      <div className={styles.factValue}>{children}</div>
      {note ? <div className={styles.factNote}>{note}</div> : null}
    </div>
  );
}

// The way to the view of another object of the installation. It opens over the one that is shown, which
// stays where the way back leads.
export function ViewLink({ target, children }: { target: ViewTarget; children?: ReactNode }) {
  return (
    <button
      type="button"
      className={styles.link}
      data-testid={`velero-open-${target.kind}-${target.name}`}
      onClick={() => openView(target)}
    >
      {children ?? target.name}
    </button>
  );
}

// A reference is a name with what is known of its target. It is a way to the target only when the target
// is there and has a view: where it cannot be opened, the reason is beside the name.
export function Target({ reference, children }: { reference: Reference; children?: ReactNode }) {
  const kind = VIEW_OF[reference.kind];

  return (
    <span data-reference={reference.state} data-testid={`velero-reference-${reference.kind}-${reference.name}`}>
      {reference.state === "resolved" && kind ? <ViewLink target={{ kind, name: reference.name }} /> : reference.name}
      {reference.state === "resolved" ? children : null}
      {reference.reason ? <span className={styles.muted}> ({reference.reason})</span> : null}
    </span>
  );
}

// The restores that name an object, each with where it is and the way to it.
export function Restores({ restores }: { restores: RelatedRestores }) {
  if (restores.state !== "listed") {
    return (
      <span className={styles.muted} data-reference={restores.state} data-testid="velero-related-restores">
        {restores.reason}
      </span>
    );
  }
  if (!restores.items.length) {
    return (
      <span data-reference="listed" data-testid="velero-related-restores">
        None{restores.stale ? " in what was read before the restores stopped answering" : ""}
      </span>
    );
  }
  return (
    <span data-reference="listed" data-testid="velero-related-restores">
      {restores.items.map((restore: RestoreResource, index) => (
        <span key={restore.metadata.uid ?? restore.metadata.name}>
          {index ? ", " : ""}
          <ViewLink target={{ kind: "restore", name: restore.metadata.name }} /> (
          {operationState("Restore", restore.status?.phase).label})
        </span>
      ))}
      {restores.stale ? <span className={styles.muted}> (read before the restores stopped answering)</span> : null}
    </span>
  );
}

export interface WorkspaceProps {
  kind: ViewKind;
  name: string;
  // Of the object that is shown, when it was found: what tells it from one created later with its name.
  uid?: string;
  // The object is a restore with a time of deletion: Velero holds it until it has removed what it keeps
  // of it. A backup is deleted through a request, and says so with its phase.
  deleting?: boolean;
  // Where the way back leads, in words.
  back: string;
  onBack: () => void;
  children?: ReactNode;
}

// What every view of one object has around it: its name, the way back, and Escape that takes it from
// wherever the focus is.
export function Workspace({ kind, name, uid, deleting, back, onBack, children }: WorkspaceProps) {
  const way = React.useRef<HTMLButtonElement>(null);
  const view = `${kind}/${name}`;
  const [opened, setOpened] = React.useState<{ view: string; uid?: string }>({ view, uid });
  const leave = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") onBack();
  };
  const { noun } = VIEWS[kind];

  // The object that was opened is the first one found under the name. One found later under the same
  // name with another identifier is another object, created after the first was deleted. What was
  // opened follows what is shown: it is set again while this is drawn, before anything is shown of it.
  if (opened.view !== view) setOpened({ view, uid });
  else if (opened.uid === undefined && uid !== undefined) setOpened({ view, uid });
  const replaced = uid !== undefined && opened.uid !== undefined && opened.uid !== uid;

  // The keyboard follows the view: it starts from the way back.
  React.useEffect(() => {
    way.current?.focus();
  }, [kind, name]);

  return (
    // Escape leaves the view from wherever the focus is in it.
    <section
      className={styles.workspace}
      data-testid={`velero-${kind}-workspace`}
      {...{ [`data-${kind}-uid`]: uid }}
      // A click on a text of the view leaves the focus in the view, where Escape is heard.
      tabIndex={-1}
      aria-labelledby={`velero-${kind}-title`}
      onKeyDown={leave}
    >
      <div className={styles.breadcrumb}>
        <button ref={way} type="button" className={styles.back} onClick={onBack} data-testid="velero-back">
          <Icon material="arrow_back" small aria-hidden />
          {back}
        </button>
        <span className={styles.title} id={`velero-${kind}-title`} data-testid={`velero-${kind}-name`}>
          {name}
        </span>
      </div>
      {replaced ? (
        <p role="status" className={`${styles.notice} ${styles.noticeWarning}`} data-testid={`velero-${kind}-replaced`}>
          <Icon material="warning_amber" small aria-hidden />
          <span>
            This is another {noun} of the same name: the one that was open was deleted, and this one was created after
            it.
          </span>
        </p>
      ) : null}
      {deleting ? (
        <p role="status" className={`${styles.notice} ${styles.noticeInfo}`} data-testid={`velero-${kind}-deleting`}>
          <Icon material="info_outline" small aria-hidden />
          <span>
            This {noun} is being deleted: the object has a time of deletion, and it goes when Velero has removed what it
            keeps of it in the storage.
          </span>
        </p>
      ) : null}
      {children}
    </section>
  );
}

// What a view shows of an object that is not among the ones that were read: that it is not there, or that
// it is not known. A list that was not read says nothing of what is in it.
export function NotShown({ kind, namespace, read }: { kind: ViewKind; namespace: string; read: FamilyRead<unknown> }) {
  const { noun } = VIEWS[kind];

  if (read.status === "idle" || read.status === "loading") return <Spinner />;
  if (read.status === "ready") {
    return (
      <p className={styles.stateText} data-testid={`velero-${kind}-missing`}>
        No {noun} of this name is in {namespace}. It may have been deleted, or it is of another installation.
      </p>
    );
  }
  return (
    <p className={styles.stateText} data-testid={`velero-${kind}-unknown`}>
      {read.status === "forbidden"
        ? `Access to the ${noun}s of ${namespace} is denied`
        : read.status === "not-served"
          ? `This cluster does not serve the ${noun}s of Velero`
          : `The ${noun}s of ${namespace} could not be read`}
      , so this one cannot be shown. It is not known to be absent.
    </p>
  );
}

// What was read before the last read, which did not succeed, and when.
export function Stale({ kind, read }: { kind: ViewKind; read: FamilyRead<unknown> }) {
  return (
    <p className={styles.factNote} data-testid={`velero-${kind}-stale`}>
      The {VIEWS[kind].noun}s could not be read again: this is what was read at{" "}
      {new Date(read.lastSuccess ?? 0).toLocaleTimeString()}.
    </p>
  );
}
