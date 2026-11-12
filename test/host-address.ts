// The address of the frame as the host keeps it, which its navigation, the parameters of a page and its links
// change, written from the source of the host at the validation target (freelensapp/freelens at
// b9b53e16056578c5407312eba5823a089972f6d5). The host keeps a browser history (packages/routing/src/
// history.injectable.ts lines 15 to 19) behind an observable one (observable-history.ts lines 60 to 231): every
// push is one change of the address, and the parameters of its search are kept without the ones that have no
// value (observable-search-params.ts lines 37 to 115, with search-params.ts lines 9 to 13): an address pushed
// with such a parameter is pushed again without it, which is a second change. How many times the address was
// changed is counted: one change of what is shown is one change of the address.

import { observable, runInAction } from "mobx";

export const addressChanges = { count: 0 };
const location = observable.box({ pathname: "/", search: "" }, { deep: false });

// The search of the address as it is now, without its question mark.
export function addressSearch(): string {
  return location.get().search;
}

// The path of the address as it is now.
export function addressPath(): string {
  return location.get().pathname;
}

// The address to the place the tests begin at.
export function resetAddress(): void {
  runInAction(() => location.set({ pathname: "/", search: "" }));
  addressChanges.count = 0;
}

// The parameters of a search as the observable history keeps them: the ones with a value, in their order.
function kept(search: string): string {
  return new URLSearchParams([...new URLSearchParams(search)].filter(([, value]) => value !== "")).toString();
}

// A push of the history (history v5, `getNextLocation`): the path of a location that gives none is the one the
// address is at, and its search is the one it gives. The search is then kept without its empty parameters, which
// pushes once more when one was left out (observable-history.ts lines 157 to 189).
function push(to: { pathname?: string; search?: string }): void {
  const pathname = to.pathname || location.get().pathname;
  const search = new URLSearchParams(to.search ?? "").toString();
  const normalized = kept(search);

  addressChanges.count += normalized === search ? 1 : 2;
  runInAction(() => location.set({ pathname, search: normalized }));
}

// A location given as a path, `/a/b?c=d`, or as its parts.
function parsed(to: string | { pathname?: string; search?: string }): { pathname?: string; search?: string } {
  if (typeof to !== "string") return to;
  const at = to.indexOf("?");

  return at < 0 ? { pathname: to } : { pathname: to.slice(0, at) || undefined, search: to.slice(at) };
}

// `history.push` of the observable history of the host.
export function pushAddress(to: string | { pathname?: string; search?: string }): void {
  push(parsed(to));
}

// `Renderer.Navigation.navigate` (packages/core/src/renderer/navigation/navigate.injectable.ts lines 31 to 47):
// the history is pushed to the location, and when that is the address it was at, sent back, so that the same
// address is not twice in the history: two changes for nothing. The two are compared before the search loses
// its empty parameters, which the reactions of the history do once the navigation ends.
export function navigate(to: string | { pathname?: string; search?: string }): void {
  const before = location.get();
  const next = parsed(to);
  const same =
    (next.pathname || before.pathname) === before.pathname &&
    new URLSearchParams(next.search ?? "").toString() === before.search;

  push(next);
  if (!same) return;
  addressChanges.count += 1;
  runInAction(() => location.set(before));
}

// `Renderer.Navigation.createPageParam` (packages/core/src/renderer/navigation/page-param.ts lines 24 to 121): a
// parameter of the address, read from its search, set by a merge of the history, which keeps the path and the
// other parameters and is one push, taken out of the search, and the search the address would have with another
// value of it.
export function createPageParam(init: {
  name: string;
  defaultValue?: unknown;
  parse?: (value: string | string[]) => unknown;
  stringify?: (value: unknown) => string | string[];
}) {
  const { name } = init;
  const isMulti = Array.isArray(init.defaultValue);
  const getRaw = (): string | string[] => {
    const values = new URLSearchParams(location.get().search).getAll(name);

    return isMulti ? values : values[0];
  };
  const parse = (values: string | string[]) => (init.parse ? init.parse(values) : values);
  const get = () => parse(getRaw()) ?? init.defaultValue;
  const stringify = (value: unknown): string[] =>
    init.stringify ? [init.stringify(value)].flat() : [value].flat().map(String);
  const toSearch = ({ mergeGlobals = true, value = get() }: { mergeGlobals?: boolean; value?: unknown } = {}) => {
    const params = mergeGlobals ? new URLSearchParams(location.get().search) : new URLSearchParams();

    params.delete(name);
    for (const one of stringify(value)) params.append(name, one);
    return params.toString();
  };

  return {
    name,
    isMulti,
    get defaultValue() {
      return init.defaultValue;
    },
    parse,
    stringify,
    get,
    getRaw,
    toString: toSearch,
    // `history.merge({ search })`: the location the address is at, with this search (observable-history.ts lines
    // 223 to 231).
    set: (value: unknown) => push({ pathname: location.get().pathname, search: toSearch({ value }) }),
    // `searchParams.delete(name)`, which changes the address only when the parameter was in it.
    clear: () => {
      const params = new URLSearchParams(location.get().search);

      if (!params.has(name)) return;
      params.delete(name);
      push({ pathname: location.get().pathname, search: params.toString() });
    },
  };
}
