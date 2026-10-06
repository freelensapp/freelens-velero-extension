import { Renderer } from "@freelensapp/extensions";
import { closed, decodeViews, encodeView, openedFrom, sameView } from "../common/views";
import { readTab } from "./components/workspace-tabs";

import type { ViewKind, ViewTarget } from "../common/views";
import type { WorkspaceTab } from "./components/workspace-tabs";

// The identifiers of the pages and of the entries of the sidebar, and the addresses of the pages. The suite
// of the views finds the entries by these names.

export const ROOT_MENU_ID = "velero";
export const OVERVIEW_PAGE_ID = "overview";
export const OVERVIEW_MENU_ID = "velero-overview";
export const BACKUPS_PAGE_ID = "backups";
export const BACKUPS_MENU_ID = "velero-backups";
export const RESTORES_PAGE_ID = "restores";
export const RESTORES_MENU_ID = "velero-restores";
export const SCHEDULES_PAGE_ID = "schedules";
export const SCHEDULES_MENU_ID = "velero-schedules";
export const STORAGE_LOCATIONS_PAGE_ID = "storage-locations";
export const STORAGE_LOCATIONS_MENU_ID = "velero-storage-locations";
export const SNAPSHOT_LOCATIONS_PAGE_ID = "snapshot-locations";
export const SNAPSHOT_LOCATIONS_MENU_ID = "velero-snapshot-locations";

// The page where the list of each kind is, which is where a link from outside the views opens one of it.
export const PAGES: Record<ViewKind, string> = {
  backup: BACKUPS_PAGE_ID,
  restore: RESTORES_PAGE_ID,
  schedule: SCHEDULES_PAGE_ID,
  "storage-location": STORAGE_LOCATIONS_PAGE_ID,
  "snapshot-location": SNAPSHOT_LOCATIONS_PAGE_ID,
};

// The views that are open travel in the address, by their kind and their name, in the order they were
// opened: the namespace is the one of the installation that is selected, and is not part of an address
// that could name another.
export const VIEW_PARAM = "view";

type ViewsParam = ReturnType<typeof Renderer.Navigation.createPageParam<string[]>>;

let views: ViewsParam | undefined;

// The parameter of the address is created when it is first read: the host is ready by then.
function viewsParam(): ViewsParam {
  if (!views) views = Renderer.Navigation.createPageParam<string[]>({ name: VIEW_PARAM, defaultValue: [] });
  return views;
}

// The views that are open, from the first that was opened to the one that is shown.
export function openViews(): ViewTarget[] {
  return decodeViews(viewsParam().get());
}

// The tab that is open of the view that is shown travels beside the views, as one parameter more: a page
// opened again shows the tab it was at, with nothing of it loaded until it is asked. The summary is said by
// no tab in the address.
export const TAB_PARAM = "tab";

type TabParam = ReturnType<typeof Renderer.Navigation.createPageParam<string>>;

let tab: TabParam | undefined;

function tabParam(): TabParam {
  if (!tab) tab = Renderer.Navigation.createPageParam<string>({ name: TAB_PARAM, defaultValue: "" });
  return tab;
}

// The tab that is open of the view that is shown: the summary for whatever else the address says, and
// where no view is open, since a tab is of a view.
export function openTab(): WorkspaceTab {
  return openViews().length ? readTab(tabParam().get()) : "summary";
}

// The search of the address that shows these views, the last of them at this tab: what else the address
// carries, which is of the page behind the views, as it is.
function searchOf(path: ViewTarget[], shown: WorkspaceTab): string {
  const search = new URLSearchParams(viewsParam().toString({ value: path.map(encodeView) }));

  search.delete(TAB_PARAM);
  if (path.length && shown !== "summary") search.set(TAB_PARAM, shown);
  return search.toString();
}

// What is shown is the views that are open and the tab of the last of them, and the address says both. The
// host changes the address once for each parameter it is given to set, and a view would be drawn between
// the two at the tab of another: both are written into one search, and the host is sent to it once. One
// change of the address for one change of what is shown, and none when nothing changes: sent to the
// address it is at, the host goes there and comes back.
function show(path: ViewTarget[], shown: WorkspaceTab): void {
  const search = searchOf(path, shown);

  if (search !== searchOf(openViews(), openTab())) Renderer.Navigation.navigate({ search });
}

// The views change. The one that is shown after them is at its summary: the tab of one view is never the
// tab of another. A view that stays the one that is shown stays at its tab.
function showViews(path: ViewTarget[]): void {
  const before = openViews();

  show(path, sameView(before[before.length - 1], path[path.length - 1]) ? openTab() : "summary");
}

// Opens a view from the one that is shown, or from the list.
export function openView(target: ViewTarget): void {
  showViews(openedFrom(openViews(), target));
}

// Takes the way back: to the view this one was opened from, or to the list.
export function closeView(): void {
  showViews(closed(openViews()));
}

export function closeViews(): void {
  showViews([]);
}

// Opens a tab of the view that is shown: the one function that writes the tab. What is not a tab is the
// summary.
export function showTab(asked: WorkspaceTab): void {
  show(openViews(), readTab(asked));
}

// The host mounts the pages of an extension under its name, without the at sign and with the slash doubled.
export function pageUrl(extensionName: string, pageId: string, query: Record<string, string> = {}): string {
  const base = `/extension/${extensionName.replace(/^@/, "").replace(/\//g, "--")}/${pageId}`;
  const search = new URLSearchParams(query).toString();

  return search ? `${base}?${search}` : base;
}

// The address that opens one view over the list of its kind, at a tab of it when one is asked.
export function viewUrl(extensionName: string, target: ViewTarget, shown: WorkspaceTab = "summary"): string {
  return pageUrl(extensionName, PAGES[target.kind], {
    [VIEW_PARAM]: encodeView(target),
    ...(shown === "summary" ? {} : { [TAB_PARAM]: shown }),
  });
}
