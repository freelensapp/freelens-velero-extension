import { describe, expect, it, vi } from "vitest";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { Installation } from "./installation";

import type { Answer, Family, Preferences } from "../../common/discovery";

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";

function object(name: string, namespace: string, uid = `${namespace}-${name}`) {
  return { metadata: { name, namespace, uid } };
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

const served: Answer = {
  status: 200,
  body: { resources: Object.values(RESOURCES).map((name) => ({ name })) },
};

// A cluster that answers from a table, and keeps the list of what it was asked.
function cluster(answers: Record<string, Answer | (() => Promise<Answer>)>) {
  const asked: string[] = [];
  const read = async (path: string): Promise<Answer> => {
    asked.push(path);
    const answer = answers[path] ?? { status: 404 };

    return typeof answer === "function" ? answer() : answer;
  };

  return { asked, read, answers };
}

// What the store of the host is for the views: it answers what was last written to it.
function storage(initial: Preferences = emptyPreferences()) {
  const written: Preferences[] = [];

  return { written, ...heldPreferences(initial, (preferences) => written.push(preferences)) };
}

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function installation(
  answers: Record<string, Answer | (() => Promise<Answer>)>,
  preferences: Preferences = emptyPreferences(),
  clock = { now: 1000 },
) {
  const api = cluster(answers);
  const kept = storage(preferences);
  const state = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: api.read,
    now: () => clock.now,
    storage: kept,
  });

  return { state, api, kept, clock };
}

const two = {
  [DISCOVERY]: served,
  [LOCATIONS]: list(object("default", "velero-a"), object("default", "velero-b")),
  [path("backups", "velero-a")]: list(object("nightly-1", "velero-a"), object("nightly-2", "velero-a")),
  [path("backups", "velero-b")]: list(object("nightly-1", "velero-b")),
  [path("restores", "velero-a")]: list(),
  [path("restores", "velero-b")]: list(),
  [path("schedules", "velero-a")]: list(object("nightly", "velero-a")),
  [path("schedules", "velero-b")]: list(),
  [path("storageLocations", "velero-a")]: list(object("default", "velero-a")),
  [path("storageLocations", "velero-b")]: list(object("default", "velero-b")),
  [path("snapshotLocations", "velero-a")]: list(),
  [path("snapshotLocations", "velero-b")]: list(),
};

describe("discovery", () => {
  it("asks nothing until a view is opened", async () => {
    const { state, api } = installation(two);

    expect(state.entry).toEqual({ state: "loading" });
    expect(api.asked).toEqual([]);
    await state.open();
    expect(api.asked.slice(0, 2).sort()).toEqual([DISCOVERY, LOCATIONS]);
  });

  it("asks once for any number of views that open", async () => {
    const { state, api } = installation(two);

    await state.open();
    const first = api.asked.length;

    await state.open();
    await state.open();
    expect(api.asked).toHaveLength(first);
  });

  it("asks for a choice among two installations and reads neither", async () => {
    const { state, api } = installation(two);

    await state.open();
    expect(state.entry).toMatchObject({ state: "choose" });
    expect(state.namespace).toBeUndefined();
    expect(api.asked.filter((asked) => asked.includes("/namespaces/"))).toEqual([]);
    expect(state.read("backups")).toEqual({ status: "idle", items: [] });
  });

  it("reads the five families of the namespace that is chosen, and of no other", async () => {
    const { state, api } = installation(two);

    await state.open();
    state.select("velero-a");
    await vi.waitFor(() => expect(state.read("backups").status).toBe("ready"));
    expect(state.entry).toEqual({ state: "ready", namespace: "velero-a", stale: false, missing: [] });
    expect(api.asked.filter((asked) => asked.includes("/namespaces/")).sort()).toEqual(
      (["backups", "restores", "schedules", "snapshotLocations", "storageLocations"] as Family[])
        .map((family) => path(family, "velero-a"))
        .sort(),
    );
    expect(state.read("backups").items.map((item) => item.metadata.name)).toEqual(["nightly-1", "nightly-2"]);
  });

  it("takes the only installation there is, and does not keep a choice the operator did not make", async () => {
    const { state, kept } = installation({ ...two, [LOCATIONS]: list(object("default", "velero-a")) });

    await state.open();
    expect(state.selection).toEqual({ state: "selected", namespace: "velero-a", reason: "only" });
    expect(state.read("backups").status).toBe("ready");
    expect(kept.written).toEqual([]);
  });

  it("only reads: it has one verb, and the paths it asks are the ones of the discovery and of the families", async () => {
    const { state, api } = installation(two);

    await state.open();
    state.select("velero-a");
    await vi.waitFor(() => expect(state.read("backups").status).toBe("ready"));
    await state.refresh();
    state.configure("velero-c");
    await vi.waitFor(() => expect(state.asked).toBeDefined());
    for (const asked of api.asked) {
      expect(asked).toMatch(
        /^\/apis\/velero\.io\/v1(\/backupstoragelocations|\/namespaces\/velero-[abc]\/(backups|restores|schedules|backupstoragelocations|volumesnapshotlocations))?$/,
      );
    }
    expect(api.asked.some((asked) => /downloadrequests|serverstatusrequests|accessreview/.test(asked))).toBe(false);
  });
});

describe("restricted access", () => {
  const restricted = {
    [DISCOVERY]: { status: 403 },
    [LOCATIONS]: { status: 403 },
    [path("backups", "velero-restricted")]: list(object("nightly-1", "velero-restricted")),
    [path("restores", "velero-restricted")]: { status: 403 },
    [path("schedules", "velero-restricted")]: list(),
    [path("storageLocations", "velero-restricted")]: list(object("default", "velero-restricted")),
    [path("snapshotLocations", "velero-restricted")]: { status: 500 },
  };

  it("does not call Velero absent when the lists of the cluster are denied", async () => {
    const { state } = installation(restricted);

    await state.open();
    expect(state.api).toEqual({ state: "restricted" });
    expect(state.found).toEqual({ state: "restricted" });
    expect(state.entry).toEqual({ state: "restricted", configurable: true });
  });

  it("reads the namespace the operator configures, without any permission on the cluster", async () => {
    const { state, kept } = installation(restricted);

    await state.open();
    expect(state.configure("velero-restricted")).toBe(true);
    await vi.waitFor(() => expect(state.asked).toBeDefined());
    expect(state.entry).toMatchObject({ state: "ready", namespace: "velero-restricted" });
    expect(state.read("backups").items.map((item) => item.metadata.name)).toEqual(["nightly-1"]);
    expect(kept.written.at(-1)).toEqual({
      selected: { "cluster-a": "velero-restricted" },
      configured: { "cluster-a": ["velero-restricted"] },
    });
  });

  it("keeps the families that were read when another is denied, and gives the denied one no count", async () => {
    const { state } = installation(restricted);

    await state.open();
    state.configure("velero-restricted");
    await vi.waitFor(() => expect(state.asked).toBeDefined());
    expect(state.read("backups")).toMatchObject({ status: "ready", items: [{}] });
    expect(state.read("storageLocations")).toMatchObject({ status: "ready", items: [{}] });
    expect(state.read("restores")).toEqual({ status: "forbidden", items: [], lastSuccess: undefined });
    expect(state.read("snapshotLocations")).toEqual({ status: "failed", items: [], lastSuccess: undefined });
    expect(state.read("schedules")).toMatchObject({ status: "ready", items: [] });
  });

  it("refuses what is not the name of a namespace, before it is part of a request", async () => {
    const { state, api, kept } = installation(restricted);

    await state.open();
    const before = api.asked.length;

    for (const name of ["", "Velero", "../velero", "velero/backups", "velero?watch=true", "a".repeat(64)]) {
      expect(state.configure(name)).toBe(false);
    }
    expect(api.asked).toHaveLength(before);
    expect(kept.written).toEqual([]);
    expect(state.entry).toEqual({ state: "restricted", configurable: true });
  });
});

describe("families whose kind is not served", () => {
  it("are named, and are not asked", async () => {
    const { state, api } = installation({
      ...two,
      [DISCOVERY]: { status: 200, body: { resources: [{ name: "backups" }, { name: "backupstoragelocations" }] } },
      [LOCATIONS]: list(object("default", "velero-a")),
    });

    await state.open();
    expect(state.entry).toEqual({
      state: "ready",
      namespace: "velero-a",
      stale: false,
      missing: ["restores", "schedules", "snapshotLocations"],
    });
    expect(state.read("restores").status).toBe("not-served");
    expect(state.read("backups").status).toBe("ready");
    expect(api.asked.filter((asked) => asked.endsWith("/restores") || asked.endsWith("/schedules"))).toEqual([]);
  });
});

describe("switch of the target", () => {
  it("takes nothing of what was asked for the namespace that is not selected any more", async () => {
    let answer: (value: Answer) => void = () => undefined;
    const late = new Promise<Answer>((resolve) => {
      answer = resolve;
    });
    const { state } = installation({ ...two, [path("backups", "velero-a")]: () => late });

    await state.open();
    state.select("velero-a");
    state.select("velero-b");
    await vi.waitFor(() => expect(state.read("backups").status).toBe("ready"));
    expect(state.read("backups").items.map((item) => item.metadata.uid)).toEqual(["velero-b-nightly-1"]);
    // The namespace selected before answers now, with a backup of the same name.
    answer(list(object("nightly-1", "velero-a"), object("nightly-2", "velero-a")));
    await late;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.namespace).toBe("velero-b");
    expect(state.read("backups").items.map((item) => item.metadata.uid)).toEqual(["velero-b-nightly-1"]);
  });

  it("shows nothing of the namespace before while the one after is being read", async () => {
    const { state } = installation(two);

    await state.open();
    state.select("velero-a");
    await vi.waitFor(() => expect(state.read("backups").status).toBe("ready"));
    state.select("velero-b");
    // Before any answer: nothing of velero-a is left to show.
    for (const family of ["backups", "schedules", "storageLocations"] as Family[]) {
      expect(state.read(family).items).toEqual([]);
      expect(state.read(family).lastSuccess).toBeUndefined();
    }
    expect(state.generation).toEqual({ cluster: "cluster-a", namespace: "velero-b", number: 2 });
  });

  it("leaves out of an answer the objects of another namespace", async () => {
    const { state } = installation({
      ...two,
      [path("backups", "velero-a")]: list(object("nightly-1", "velero-a"), object("nightly-1", "velero-b")),
    });

    await state.open();
    state.select("velero-a");
    await vi.waitFor(() => expect(state.read("backups").status).toBe("ready"));
    expect(state.read("backups").items.map((item) => item.metadata.uid)).toEqual(["velero-a-nightly-1"]);
  });

  it("does not select a namespace that cannot be chosen", async () => {
    const { state, kept } = installation(two);

    await state.open();
    state.select("velero-z");
    state.select("kube-system");
    expect(state.entry).toMatchObject({ state: "choose" });
    expect(kept.written).toEqual([]);
  });
});

describe("a namespace that is not there any more", () => {
  it("stays the one selected, and is not replaced by the one that is left", async () => {
    const { state, kept } = installation(
      { ...two, [LOCATIONS]: list(object("default", "velero-b")) },
      { selected: { "cluster-a": "velero-a" }, configured: {} },
    );

    await state.open();
    expect(state.selection).toEqual({ state: "stale", namespace: "velero-a" });
    expect(state.entry).toMatchObject({ state: "ready", namespace: "velero-a", stale: true });
    expect(kept.written).toEqual([]);
  });

  it("is of its cluster: the choice made in another cluster is not taken", async () => {
    const { state } = installation(two, { selected: { "cluster-b": "velero-b" }, configured: {} });

    await state.open();
    expect(state.entry).toMatchObject({ state: "choose" });
  });
});

describe("refresh", () => {
  it("keeps what was read, and when, if the next read does not succeed", async () => {
    const clock = { now: 1000 };
    const answers: Record<string, Answer> = { ...two, [LOCATIONS]: list(object("default", "velero-a")) };
    const { state } = installation(answers, emptyPreferences(), clock);

    await state.open();
    expect(state.read("backups")).toMatchObject({ status: "ready", lastSuccess: 1000 });
    clock.now = 5000;
    answers[path("backups", "velero-a")] = { status: 500, body: { message: "the server could not find it" } };
    answers[path("schedules", "velero-a")] = {};
    await state.refresh();
    expect(state.read("backups")).toMatchObject({ status: "failed", lastSuccess: 1000 });
    expect(state.read("backups").items.map((item) => item.metadata.name)).toEqual(["nightly-1", "nightly-2"]);
    expect(state.read("schedules")).toMatchObject({ status: "failed", lastSuccess: 1000, items: [{}] });
    expect(state.read("storageLocations")).toMatchObject({ status: "ready", lastSuccess: 5000 });
    expect(state.asked).toBe(5000);
  });

  it("does not turn a failed discovery into an absence", async () => {
    const answers: Record<string, Answer> = { ...two, [LOCATIONS]: list(object("default", "velero-a")) };
    const { state } = installation(answers);

    await state.open();
    answers[DISCOVERY] = { status: 503, body: "404 page not found" };
    await state.refresh();
    expect(state.api).toEqual({ state: "failed" });
    expect(state.entry).toMatchObject({ state: "ready", namespace: "velero-a" });
  });
});

describe("what is kept between two sessions", () => {
  it("is the namespaces the operator chose and configured", async () => {
    const { state, kept } = installation(two);

    await state.open();
    state.select("velero-b");
    state.configure("velero-c");
    await vi.waitFor(() => expect(state.asked).toBeDefined());
    expect(kept.written.at(-1)).toEqual({
      selected: { "cluster-a": "velero-c" },
      configured: { "cluster-a": ["velero-c"] },
    });
    expect(JSON.stringify(kept.written)).not.toMatch(/nightly|uid|resourceVersion|token|kubeconfig|write/i);
  });

  it("forgets a namespace that was configured, and with it the selection of that namespace", async () => {
    const { state, kept } = installation(two, {
      selected: { "cluster-a": "velero-c", "cluster-b": "velero-c" },
      configured: { "cluster-a": ["velero-c"], "cluster-b": ["velero-c"] },
    });

    await state.open();
    expect(state.namespace).toBe("velero-c");
    state.forget("velero-c");
    expect(kept.written.at(-1)).toEqual({
      selected: { "cluster-b": "velero-c" },
      configured: { "cluster-b": ["velero-c"] },
    });
    expect(state.entry).toMatchObject({ state: "choose" });
  });

  it("keeps the window of the recent operations that was chosen, and asks nothing of the cluster for it", async () => {
    const { state, kept, api } = installation(two, { selected: { "cluster-a": "velero-a" }, configured: {} });

    await state.open();
    // Seven days when none was chosen.
    expect(state.window).toBe("7d");
    const asked = api.asked.length;

    state.chooseWindow("30d");
    expect(state.window).toBe("30d");
    expect(kept.written.at(-1)).toEqual({ selected: { "cluster-a": "velero-a" }, configured: {}, window: "30d" });
    expect(api.asked).toHaveLength(asked);
    // What is not one of the three is not taken.
    const written = kept.written.length;

    state.chooseWindow("1h" as never);
    state.chooseWindow(undefined as never);
    expect(state.window).toBe("30d");
    expect(kept.written).toHaveLength(written);
    // The window is of the extension, and stays when a namespace is chosen, named or taken back.
    state.select("velero-b");
    expect(kept.written.at(-1)).toMatchObject({ selected: { "cluster-a": "velero-b" }, window: "30d" });
    state.configure("velero-c");
    expect(kept.written.at(-1)).toMatchObject({ configured: { "cluster-a": ["velero-c"] }, window: "30d" });
    state.forget("velero-c");
    expect(kept.written.at(-1)).toEqual({ selected: {}, configured: {}, window: "30d" });
    expect(JSON.stringify(kept.written)).not.toMatch(/nightly|uid|resourceVersion|token|kubeconfig|write/i);
  });

  it("keeps what the frame of another cluster kept, and takes the window that was chosen there", async () => {
    // One store for every cluster, and an installation for the frame of each.
    const store = storage();
    const frame = (id: string) =>
      new Installation({
        cluster: { id, name: id },
        read: cluster(two).read,
        now: () => 1000,
        storage: store,
      });
    const one = frame("cluster-a");
    const other = frame("cluster-b");

    await one.open();
    await other.open();
    one.select("velero-a");
    one.chooseWindow("30d");
    // The other frame was made before the window was chosen: what it keeps is added to what the store
    // holds now, and takes nothing away from it.
    other.select("velero-b");
    other.configure("velero-c");
    expect(store.read()).toEqual({
      selected: { "cluster-a": "velero-a", "cluster-b": "velero-c" },
      configured: { "cluster-b": ["velero-c"] },
      window: "30d",
    });
    expect(other.window).toBe("30d");
    // A window chosen in one frame is the one of the other at its next read.
    other.chooseWindow("24h");
    expect(one.window).toBe("30d");
    await one.refresh();
    expect(one.window).toBe("24h");
    expect(one.namespace).toBe("velero-a");
    one.forget("velero-a");
    expect(store.read()).toMatchObject({ selected: { "cluster-b": "velero-c" }, window: "24h" });
  });

  it("takes the window that was kept, and seven days for one that is not a window", () => {
    expect(installation(two, { ...emptyPreferences(), window: "24h" }).state.window).toBe("24h");
    expect(installation(two, { ...emptyPreferences(), window: "soon" as never }).state.window).toBe("7d");
  });
});

describe("an installation that is being read", () => {
  // Answers that wait for a word: what is asked is held until it is let go.
  function held() {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    return {
      release,
      answer: (value: Answer) => async () => {
        await gate;
        return value;
      },
    };
  }

  it("says so from the moment a read is asked, while it looks for the installations as well", async () => {
    const discovery = held();
    const families = held();
    const one = { ...two, [LOCATIONS]: list(object("default", "velero-a")) };
    const { state, api } = installation(one);

    await state.open();
    expect(state.reading).toBe(false);
    expect(state.read("backups")).toMatchObject({ status: "ready" });
    api.answers[DISCOVERY] = discovery.answer(served);
    api.answers[path("backups", "velero-a")] = families.answer(list(object("nightly-1", "velero-a")));
    const read = state.refresh();

    // The families are not asked yet: the read that was asked is the one of what the cluster serves.
    expect(state.reading).toBe(true);
    expect(state.read("backups").reading).toBeUndefined();
    discovery.release();
    await vi.waitFor(() => expect(state.read("backups").reading).toBe(true));
    expect(state.reading).toBe(true);
    // What was read is what the last read said, until this one ends.
    expect(state.read("backups")).toMatchObject({ status: "ready" });
    expect(state.read("backups").items).toHaveLength(2);
    families.release();
    await read;
    expect(state.reading).toBe(false);
    expect(state.asking).toBe(0);
    expect(state.read("backups").items).toHaveLength(1);
  });

  it("says so while the families of a namespace that was selected are read", async () => {
    const families = held();
    const { state, api } = installation(two, { selected: { "cluster-a": "velero-a" }, configured: {} });

    await state.open();
    expect(state.reading).toBe(false);
    api.answers[path("backups", "velero-b")] = families.answer(list(object("nightly-1", "velero-b")));
    state.select("velero-b");
    expect(state.reading).toBe(true);
    // Nothing was read of this namespace yet: its families are loading, which is not being read again.
    expect(state.read("backups")).toMatchObject({ status: "loading", items: [] });
    families.release();
    await vi.waitFor(() => expect(state.reading).toBe(false));
    expect(state.read("backups")).toMatchObject({ status: "ready" });
    expect(state.read("backups").items).toHaveLength(1);
  });

  it("stops saying so when a read ends, whatever it answered", async () => {
    const { state, api } = installation({ ...two, [LOCATIONS]: list(object("default", "velero-a")) });

    await state.open();
    api.answers[DISCOVERY] = { status: 500 };
    api.answers[path("restores", "velero-a")] = { status: 403 };
    await state.refresh();
    expect(state.reading).toBe(false);
    expect(state.asking).toBe(0);
    // Two reads asked one over the other end one after the other, and nothing is being read after both.
    await Promise.all([state.refresh(), state.refresh()]);
    expect(state.reading).toBe(false);
    expect(state.asking).toBe(0);
  });
});

describe("a view that is open", () => {
  it("asks again while it is open, and stops when the last one closes", async () => {
    vi.useFakeTimers();
    try {
      const { state, api } = installation({ ...two, [LOCATIONS]: list(object("default", "velero-a")) });

      await state.open();
      const opened = api.asked.length;
      const first = state.watch(1000);
      const second = state.watch(1000);

      await vi.advanceTimersByTimeAsync(1000);
      expect(api.asked.length).toBe(opened + 5);
      first();
      await vi.advanceTimersByTimeAsync(1000);
      expect(api.asked.length).toBe(opened + 10);
      second();
      await vi.advanceTimersByTimeAsync(5000);
      expect(api.asked.length).toBe(opened + 10);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
