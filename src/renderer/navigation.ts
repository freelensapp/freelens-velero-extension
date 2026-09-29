import { Renderer } from "@freelensapp/extensions";
import { closed, decodeViews, encodeView, openedFrom } from "../common/views";

import type { ViewKind, ViewTarget } from "../common/views";

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

function show(path: ViewTarget[]): void {
  // One change of the address for one change of what is shown.
  if (path.length) viewsParam().set(path.map(encodeView));
  else viewsParam().clear();
}

// Opens a view from the one that is shown, or from the list.
export function openView(target: ViewTarget): void {
  show(openedFrom(openViews(), target));
}

// Takes the way back: to the view this one was opened from, or to the list.
export function closeView(): void {
  show(closed(openViews()));
}

export function closeViews(): void {
  show([]);
}

// The host mounts the pages of an extension under its name, without the at sign and with the slash doubled.
export function pageUrl(extensionName: string, pageId: string, query: Record<string, string> = {}): string {
  const base = `/extension/${extensionName.replace(/^@/, "").replace(/\//g, "--")}/${pageId}`;
  const search = new URLSearchParams(query).toString();

  return search ? `${base}?${search}` : base;
}

// The address that opens one view over the list of its kind.
export function viewUrl(extensionName: string, target: ViewTarget): string {
  return pageUrl(extensionName, PAGES[target.kind], { [VIEW_PARAM]: encodeView(target) });
}
