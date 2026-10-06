import { beforeEach, describe, expect, it } from "vitest";
import { addressChanges, addressSearch, Renderer } from "../../test/freelens-extensions";
import { closeView, closeViews, openTab, openView, openViews, showTab, viewUrl } from "./navigation";

const NIGHTLY = { kind: "backup" as const, name: "nightly" };
const RESTORED = { kind: "restore" as const, name: "of-nightly" };

// The address as a link, or the operator, writes it.
function address(search: string): void {
  Renderer.Navigation.navigate({ search });
}

// How many times the address changes while something is done.
function changes(act: () => void): number {
  const before = addressChanges.count;

  act();
  return addressChanges.count - before;
}

beforeEach(() => {
  if (addressSearch()) address("");
});

describe("the tab in the address, beside the views", () => {
  it("is the tab that is open of the view that is shown, and the summary for anything else", () => {
    for (const tab of ["log", "results", "resources", "volumes"]) {
      address(`view=backup/nightly&tab=${tab}`);
      expect(openTab()).toBe(tab);
    }
    for (const search of [
      "view=backup/nightly",
      "view=backup/nightly&tab=summary",
      "view=backup/nightly&tab=Log",
      "view=backup/nightly&tab=contents",
      "view=backup/nightly&tab=log&tab=results",
    ]) {
      address(search);
      expect([search, openTab()]).toEqual([search, search.endsWith("tab=log&tab=results") ? "log" : "summary"]);
    }
    // A tab is of a view: with none open there is none.
    address("tab=log");
    expect(openTab()).toBe("summary");
  });

  it("is written by one function, with one change of the address, and is not in it when it is the summary", () => {
    openView(NIGHTLY);
    expect(changes(() => showTab("log"))).toBe(1);
    expect(addressSearch()).toBe("view=backup%2Fnightly&tab=log");
    expect(openTab()).toBe("log");
    expect(openViews()).toEqual([NIGHTLY]);
    expect(changes(() => showTab("volumes"))).toBe(1);
    expect(addressSearch()).toBe("view=backup%2Fnightly&tab=volumes");
    expect(changes(() => showTab("summary"))).toBe(1);
    expect(addressSearch()).toBe("view=backup%2Fnightly");
    expect(openTab()).toBe("summary");
    // What is not a tab is the summary, which is what is shown: nothing is written.
    expect(changes(() => showTab("contents" as never))).toBe(0);
    expect(addressSearch()).toBe("view=backup%2Fnightly");
    // With no view open there is nothing a tab would be of.
    closeViews();
    expect(changes(() => showTab("log"))).toBe(0);
    expect(addressSearch()).toBe("");
  });

  it("keeps what else the address carries, which is of the page behind the views", () => {
    address("search=night&view=backup/nightly&sort=name");
    showTab("results");
    expect(new URLSearchParams(addressSearch()).get("search")).toBe("night");
    expect(new URLSearchParams(addressSearch()).get("sort")).toBe("name");
    openView(RESTORED);
    closeViews();
    expect(addressSearch()).toBe("search=night&sort=name");
  });
});

describe("a view opened over another, and the way back", () => {
  it("show the summary, with one change of the address for both parameters: the tab of one view is never the tab of another", () => {
    address("search=night&view=backup/nightly&tab=log");
    expect(openTab()).toBe("log");
    // The views and the tab change together: no address names the restore at the tab of the backup.
    expect(changes(() => openView(RESTORED))).toBe(1);
    expect(openViews()).toEqual([NIGHTLY, RESTORED]);
    expect(openTab()).toBe("summary");
    expect(addressSearch()).toBe("search=night&view=backup%2Fnightly&view=restore%2Fof-nightly");
    showTab("results");
    expect(openTab()).toBe("results");
    // The way back leads to the backup, at its summary: not at the tab of the restore, nor at the one it
    // was left at.
    expect(changes(() => closeView())).toBe(1);
    expect(openViews()).toEqual([NIGHTLY]);
    expect(openTab()).toBe("summary");
    expect(addressSearch()).toBe("search=night&view=backup%2Fnightly");
  });

  it("show the summary of a view that is gone back to along the way, and nothing of a tab once every view is closed", () => {
    address("view=backup/nightly&view=restore/of-nightly&tab=volumes");
    expect(changes(() => openView(NIGHTLY))).toBe(1);
    expect(openViews()).toEqual([NIGHTLY]);
    expect(openTab()).toBe("summary");
    showTab("log");
    expect(changes(() => closeViews())).toBe(1);
    expect(openViews()).toEqual([]);
    expect(addressSearch()).toBe("");
    // A view opened from the list is at its summary, whatever the address said of a tab before.
    address("tab=resources");
    expect(changes(() => openView(NIGHTLY))).toBe(1);
    expect(addressSearch()).toBe("view=backup%2Fnightly");
  });

  it("change nothing of the address when what is shown does not change", () => {
    address("view=backup/nightly&tab=log");
    // The view that is shown, opened again, stays at its tab.
    expect(changes(() => openView(NIGHTLY))).toBe(0);
    expect(changes(() => showTab("log"))).toBe(0);
    expect(openTab()).toBe("log");
    closeViews();
    expect(changes(() => closeViews())).toBe(0);
    expect(changes(() => closeView())).toBe(0);
    expect(changes(() => showTab("summary"))).toBe(0);
  });
});

describe("the address that opens one view", () => {
  it("names the view over the list of its kind, and a tab of it when one is asked", () => {
    expect(viewUrl("@freelensapp/velero-extension", NIGHTLY)).toBe(
      "/extension/freelensapp--velero-extension/backups?view=backup%2Fnightly",
    );
    expect(viewUrl("@freelensapp/velero-extension", RESTORED, "log")).toBe(
      "/extension/freelensapp--velero-extension/restores?view=restore%2Fof-nightly&tab=log",
    );
    // The summary is said by no tab.
    expect(viewUrl("@freelensapp/velero-extension", NIGHTLY, "summary")).toBe(
      "/extension/freelensapp--velero-extension/backups?view=backup%2Fnightly",
    );
    // The address the views read is the one a link is written with.
    address(viewUrl("@freelensapp/velero-extension", RESTORED, "results").split("?")[1]);
    expect(openViews()).toEqual([RESTORED]);
    expect(openTab()).toBe("results");
  });
});
