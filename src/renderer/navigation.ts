import { Renderer } from "@freelensapp/extensions";

// The identifiers of the pages and of the entries of the sidebar, and the addresses of the pages. The suite
// of the views finds the entries by these names.

export const ROOT_MENU_ID = "velero";
export const BACKUPS_PAGE_ID = "backups";
export const BACKUPS_MENU_ID = "velero-backups";

// The backup that is open in the workspace travels in the address, by its name: the namespace is the one of
// the installation that is selected, and is not part of an address that could name another.
export const BACKUP_PARAM = "backup";

type PageParam = ReturnType<typeof Renderer.Navigation.createPageParam<string>>;

const params = new Map<string, PageParam>();

// A parameter of the address of a page, created when it is first read: the host is ready by then.
export function pageParam(name: string): PageParam {
  let param = params.get(name);

  if (!param) {
    param = Renderer.Navigation.createPageParam<string>({ name, defaultValue: "" });
    params.set(name, param);
  }
  return param;
}

// The host mounts the pages of an extension under its name, without the at sign and with the slash doubled.
export function pageUrl(extensionName: string, pageId: string, query: Record<string, string> = {}): string {
  const base = `/extension/${extensionName.replace(/^@/, "").replace(/\//g, "--")}/${pageId}`;
  const search = new URLSearchParams(query).toString();

  return search ? `${base}?${search}` : base;
}
