// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { panelId, readTab, tabId, WORKSPACE_TABS, type WorkspaceTab, WorkspaceTabs } from "./workspace-tabs";

function Strip({ kind = "backup", first = "summary" }: { kind?: "backup" | "restore"; first?: WorkspaceTab }) {
  const [current, setCurrent] = React.useState<WorkspaceTab>(first);

  return (
    <>
      <WorkspaceTabs kind={kind} current={current} onChange={setCurrent} />
      <div role="tabpanel" id={panelId(kind)} aria-labelledby={tabId(kind, current)} data-testid="panel">
        {current}
      </div>
    </>
  );
}

afterEach(() => cleanup());

describe("the tabs of a workspace", () => {
  it("are the summary and the four artifacts, in that order, as a list of tabs that says which is selected", () => {
    render(<Strip />);
    const list = screen.getByRole("tablist");
    const tabs = screen.getAllByRole("tab");

    expect(list.getAttribute("aria-label")).toBe("What is shown of the backup");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Summary", "Log", "Results", "Resources", "Volumes"]);
    expect(WORKSPACE_TABS.map((tab) => tab.id)).toEqual(["summary", "log", "results", "resources", "volumes"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false", "false"]);
    // The host is told which tab is open, and draws that one as the tab that is shown.
    expect(tabs.map((tab) => tab.classList.contains("active"))).toEqual([true, false, false, false, false]);
    // Each tab names the panel it shows, and the panel the tab that is shown.
    for (const tab of tabs) expect(tab.getAttribute("aria-controls")).toBe("velero-backup-panel");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("velero-backup-tab-summary");
    expect(tabs[1].id).toBe("velero-backup-tab-log");
  });

  it("chooses a tab with a click, Enter or Space, and says that it is the one selected", () => {
    render(<Strip kind="restore" />);
    const tabs = screen.getAllByRole("tab");

    fireEvent.click(tabs[2]);
    expect(screen.getByTestId("panel").textContent).toBe("results");
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "false", "true", "false", "false"]);
    // And the host draws it as the one that is shown, and no other.
    expect(tabs.map((tab) => tab.classList.contains("active"))).toEqual([false, false, true, false, false]);
    fireEvent.keyDown(tabs[4], { key: "Enter" });
    expect(screen.getByTestId("panel").textContent).toBe("volumes");
    fireEvent.keyDown(tabs[1], { key: " " });
    expect(screen.getByTestId("panel").textContent).toBe("log");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("velero-restore-tab-log");
  });

  it("keeps Space for the choice of a tab: the view that holds the tabs is not scrolled by it", () => {
    render(<Strip />);
    const tabs = screen.getAllByRole("tab");

    // What a key does by itself is done unless the key is taken: Space scrolls what holds the focus by a
    // page, which the tab of the host does not stop when it takes the key for its choice.
    expect(fireEvent.keyDown(tabs[2], { key: " " })).toBe(false);
    expect(screen.getByTestId("panel").textContent).toBe("results");
    // On the tab that is shown it chooses nothing, and scrolls nothing either.
    expect(fireEvent.keyDown(tabs[2], { key: " " })).toBe(false);
    expect(screen.getByTestId("panel").textContent).toBe("results");
    // Enter scrolls nothing by itself, and the keys that are not of the tabs are left as they are.
    expect(fireEvent.keyDown(tabs[1], { key: "Enter" })).toBe(true);
    expect(screen.getByTestId("panel").textContent).toBe("log");
    for (const key of ["Tab", "a", "PageDown", "Escape"])
      expect([key, fireEvent.keyDown(tabs[1], { key })]).toEqual([key, true]);
    // The keys that move among the tabs are taken, as they were.
    expect(fireEvent.keyDown(tabs[1], { key: "ArrowRight" })).toBe(false);
  });

  it("moves the focus among the tabs with the arrows, Home and End, around the ends, and chooses none by it", () => {
    render(<Strip />);
    const tabs = screen.getAllByRole("tab");
    const focused = () => tabs.indexOf(document.activeElement as HTMLElement);
    const press = (key: string) => fireEvent.keyDown(document.activeElement as HTMLElement, { key });

    tabs[0].focus();
    press("ArrowRight");
    expect(focused()).toBe(1);
    press("ArrowRight");
    press("ArrowRight");
    press("ArrowRight");
    expect(focused()).toBe(4);
    // Past the last is the first, and before the first is the last.
    press("ArrowRight");
    expect(focused()).toBe(0);
    press("ArrowLeft");
    expect(focused()).toBe(4);
    press("Home");
    expect(focused()).toBe(0);
    press("End");
    expect(focused()).toBe(4);
    press("ArrowLeft");
    expect(focused()).toBe(3);
    // Another key moves nothing, and the focus that moved chose nothing: the summary is still shown.
    press("ArrowDown");
    press("a");
    expect(focused()).toBe(3);
    expect(screen.getByTestId("panel").textContent).toBe("summary");
    // Enter chooses the tab the focus is on.
    press("Enter");
    expect(screen.getByTestId("panel").textContent).toBe("resources");
  });

  it("reads the tab an address names, and the summary for what names none", () => {
    for (const tab of ["summary", "log", "results", "resources", "volumes"]) expect(readTab(tab)).toBe(tab);
    for (const other of [undefined, null, "", "Log", "contents", 3, ["log"], "constructor"])
      expect([other, readTab(other)]).toEqual([other, "summary"]);
  });
});
