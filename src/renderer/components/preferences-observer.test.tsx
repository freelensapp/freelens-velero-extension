// @vitest-environment jsdom

// The store of the preferences on the MobX of the host: its instances are serialized by `toJSON`, so it keeps a
// plain field with an annotation map (observableRef), and what changes it through MobX reaches the views
// that read it, and the reaction the host saves the file with.

import { act, cleanup, render, screen } from "@testing-library/react";
import { reaction, runInAction } from "mobx";
import { observer } from "mobx-react";
import { afterEach, describe, expect, it } from "vitest";
import { RESOURCES } from "../../common/discovery";
import { PreferencesStore } from "../../common/preferences-store";
import { Installation } from "../state/installation";

import type { Answer } from "../../common/discovery";

afterEach(() => {
  cleanup();
});

describe("the store of the preferences, read by the views", () => {
  it("is followed by an observer when it changes through MobX, from the views or from the host", () => {
    const store = new PreferencesStore();
    const Shown = observer(() => <span data-testid="window">{store.read().window ?? "not chosen"}</span>);

    render(<Shown />);
    expect(screen.getByTestId("window").textContent).toBe("not chosen");
    act(() => runInAction(() => store.write({ ...store.read(), window: "24h" })));
    expect(screen.getByTestId("window").textContent).toBe("24h");
    // What another window changed, as the host gives it to the store.
    act(() => runInAction(() => store.fromStore({ ...store.toJSON(), window: "30d" })));
    expect(screen.getByTestId("window").textContent).toBe("30d");
  });

  it("gives the reaction the host saves it with one change for each change made through MobX", () => {
    const store = new PreferencesStore();
    const saved: unknown[] = [];
    const stop = reaction(
      () => store.toJSON(),
      (model) => saved.push(model),
    );

    runInAction(() => store.write({ ...store.read(), selected: { "cluster-a": "velero" } }));
    runInAction(() => store.write({ ...store.read(), window: "24h" }));
    stop();
    expect(saved).toEqual([
      { selected: { "cluster-a": "velero" }, configured: {}, allowances: {} },
      { selected: { "cluster-a": "velero" }, configured: {}, window: "24h", allowances: {} },
    ]);
  });

  it("carries a namespace chosen in the views to every view that reads it, and to the store", async () => {
    const store = new PreferencesStore();
    const located = (namespace: string) => ({ metadata: { name: "default", namespace } });
    const answers: Record<string, Answer> = {
      "/apis/velero.io/v1": { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } },
      "/apis/velero.io/v1/backupstoragelocations": { status: 200, body: { items: [located("a"), located("b")] } },
    };
    const installation = new Installation({
      cluster: { id: "cluster-a", name: "demo" },
      read: async (path) => answers[path] ?? { status: 404 },
      now: () => 0,
      storage: store,
    });
    const Bar = observer(() => <span data-testid="bar">{installation.namespace ?? "none"}</span>);
    const Page = observer(() => <span data-testid="page">{installation.selection.state}</span>);

    render(
      <>
        <Bar />
        <Page />
      </>,
    );
    await act(async () => {
      await installation.open();
    });
    expect(screen.getByTestId("bar").textContent).toBe("none");
    act(() => installation.select("b"));
    expect(screen.getByTestId("bar").textContent).toBe("b");
    expect(screen.getByTestId("page").textContent).toBe("selected");
    expect(store.toJSON().selected).toEqual({ "cluster-a": "b" });
  });
});
