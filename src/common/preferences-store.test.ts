import { describe, expect, it } from "vitest";
import { PreferencesStore } from "./preferences-store";

import type { Allowance, Allowances } from "./allowances";

const ORIGIN = "https://storage.example:9000";
const HELD: Allowance = { what: "private", origin: ORIGIN, since: 1000 };
const FORGED: Allowance = { what: "http", origin: "http://elsewhere.example", since: 2000 };

describe("the store of the preferences, as the host keeps it", () => {
  it("gives the host the key of the allowances whatever it holds, so that one taken back leaves the file", () => {
    // The host writes a file key by key, from what the store gives it, and removes none: a key that is
    // left out when nothing is allowed would keep in the file what it held before.
    const store = new PreferencesStore();

    expect(store.toJSON()).toEqual({ selected: {}, configured: {}, allowances: {} });
    store.write({ selected: {}, configured: {}, allowances: { "cluster-a": [HELD] } });
    expect(store.toJSON().allowances).toEqual({ "cluster-a": [HELD] });
    store.write({ selected: { "cluster-a": "velero" }, configured: {} });
    expect(store.toJSON()).toEqual({ selected: { "cluster-a": "velero" }, configured: {}, allowances: {} });
    // What the views read of it has no such key when nothing is allowed, as before.
    expect("allowances" in store.read()).toBe(false);
  });

  it("takes from a window the namespaces and the window of time, and nothing of what is allowed, in the process that keeps the allowances", () => {
    const store = new PreferencesStore();

    store.keepAllowances();
    // The first thing it is given is the file, which is what holds the allowances between two starts.
    store.fromStore({ selected: { "cluster-a": "velero" }, configured: {}, allowances: { "cluster-a": [HELD] } });
    expect(store.read().allowances).toEqual({ "cluster-a": [HELD] });
    // After it, what it is given comes from a window: an allowance for this cluster or for another, one
    // taken out, or none at all, leave what this process holds.
    const windows: (Allowances | undefined)[] = [
      { "cluster-a": [HELD, FORGED] },
      { "cluster-a": [HELD], "cluster-b": [FORGED] },
      { "cluster-a": [] },
      {},
      undefined,
    ];

    for (const sent of windows) {
      store.fromStore({
        selected: { "cluster-a": "velero-b" },
        configured: { "cluster-a": ["velero-b"] },
        window: "30d",
        ...(sent ? { allowances: sent } : {}),
      });
      expect(store.read()).toEqual({
        selected: { "cluster-a": "velero-b" },
        configured: { "cluster-a": ["velero-b"] },
        window: "30d",
        allowances: { "cluster-a": [HELD] },
      });
    }
    // What this process writes itself, through its procedures, is what changes them.
    store.write({ ...store.read(), allowances: { "cluster-a": [HELD, FORGED] } });
    expect(store.read().allowances).toEqual({ "cluster-a": [HELD, FORGED] });
    store.write({ selected: {}, configured: {} });
    expect("allowances" in store.read()).toBe(false);
    // With nothing held, a window gives nothing either.
    store.fromStore({ selected: {}, configured: {}, allowances: { "cluster-b": [FORGED] } });
    expect("allowances" in store.read()).toBe(false);
  });

  it("takes what it is given whole in a window, which is told what is allowed by the process that keeps it", () => {
    const store = new PreferencesStore();

    store.fromStore({ selected: {}, configured: {}, allowances: { "cluster-a": [HELD] } });
    store.fromStore({ selected: {}, configured: {}, allowances: { "cluster-a": [HELD, FORGED] } });
    expect(store.read().allowances).toEqual({ "cluster-a": [HELD, FORGED] });
    store.fromStore({ selected: {}, configured: {} });
    expect("allowances" in store.read()).toBe(false);
  });
});
