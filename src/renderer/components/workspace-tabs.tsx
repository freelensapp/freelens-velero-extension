import { Renderer } from "@freelensapp/extensions";
import { ARTIFACT_TABS } from "../../common/artifact-text";

import type React from "react";

import type { ArtifactTab } from "../../common/artifact-text";

const {
  Component: { Tab, Tabs },
} = Renderer;

// What a workspace of a backup or of a restore shows: its summary, or one of the artifacts Velero wrote
// of the operation into its storage.
export type WorkspaceTab = "summary" | ArtifactTab;

export const WORKSPACE_TABS: readonly { id: WorkspaceTab; title: string }[] = [
  { id: "summary", title: "Summary" },
  ...ARTIFACT_TABS.map((tab) => ({ id: tab.id, title: tab.title })),
];

// The tab an address names, or the summary for what names none.
export function readTab(value: unknown): WorkspaceTab {
  return WORKSPACE_TABS.find((tab) => tab.id === value)?.id ?? "summary";
}

// The identifiers of a tab and of the panel it shows, which name each other.
export function tabId(kind: "backup" | "restore", tab: WorkspaceTab): string {
  return `velero-${kind}-tab-${tab}`;
}

export function panelId(kind: "backup" | "restore"): string {
  return `velero-${kind}-panel`;
}

// The arrows, Home and End move the focus among the tabs of a list, around its ends: what the tabs of
// the host do not do by themselves. The tab that has the focus is chosen with Enter or Space, as the host
// has it. The host takes Space for the choice and leaves the key to the browser, which scrolls what holds
// the focus by a page for it: on a tab the key is taken here, and the view is not scrolled.
function move(event: React.KeyboardEvent<HTMLElement>): void {
  const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
  const at = tabs.indexOf(event.target as HTMLElement);

  if (at >= 0 && event.key === " ") {
    event.preventDefault();
    return;
  }
  const to =
    at < 0
      ? -1
      : event.key === "ArrowRight"
        ? (at + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (at - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;

  if (to < 0) return;
  event.preventDefault();
  tabs[to].focus();
}

// The tabs of a workspace, built on the ones of the host, which give a tab its role and its choice by a
// click, Enter and Space. What they lack for a list of tabs is added: the role of the list and its name,
// whether each tab is selected, the panel it shows, and the arrows, Home and End. Choosing a tab asks
// nothing of the cluster: an artifact is loaded by a command of its own tab.
export function WorkspaceTabs({
  kind,
  current,
  onChange,
}: {
  kind: "backup" | "restore";
  current: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
}) {
  // The host types its strip with the events of an element and no more: its role is given beside them.
  const list = { role: "tablist" } as object;

  return (
    <Tabs
      {...list}
      aria-label={`What is shown of the ${kind}`}
      data-testid={`velero-${kind}-tabs`}
      value={current}
      onChange={onChange}
      onKeyDown={move}
    >
      {WORKSPACE_TABS.map((tab) => (
        <Tab
          key={tab.id}
          id={tabId(kind, tab.id)}
          value={tab.id}
          label={tab.title}
          aria-selected={tab.id === current}
          aria-controls={panelId(kind)}
          data-testid={tabId(kind, tab.id)}
        />
      ))}
    </Tabs>
  );
}
