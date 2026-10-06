import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notTheText, savingText } from "../../common/artifact-text";
import { downloadFailure } from "../../common/diagnostic-text";
import { ARTIFACT_HOLD_MS, ARTIFACT_TEXT_BOUND, PAGE_BOUND } from "../../common/ipc";
import { ArtifactLoad } from "./artifact-load";

import type { Answer, ArtifactPage, ArtifactSaved, ArtifactValue, Failure, WriteStatus } from "../../common/ipc";
import type { ArtifactClient, WriteClient } from "../api/ipc";

const TARGET = { kind: "Backup" as const, name: "nightly", uid: "backup-uid" };
const VALUE: ArtifactValue = {
  request: { name: "nightly-request-1", uid: "request-uid" },
  size: 11,
  pages: 2,
  route: { mode: "tunnel", encrypted: false, origin: "http://seaweedfs.velero.svc:8333" },
};
const failed = (code: Failure["code"], stage: string, more: Partial<Failure> = {}): Failure => ({
  ok: false,
  code,
  stage,
  retry: false,
  text: `synthetic ${code} at ${stage}`,
  ...more,
});

// The main process, as a tab sees it: every call is recorded, and a download and a saving answer when the
// test says.
function fixture(options: { writesOn?: boolean; target?: typeof TARGET | undefined; client?: boolean } = {}) {
  const calls: string[] = [];
  // What answers each download that was run, in the order they were run, and the last of them.
  const answers: ((value: Answer<ArtifactValue>) => void)[] = [];
  let answer: (value: Answer<ArtifactValue>) => void = () => undefined;
  let saved: (value: Answer<ArtifactSaved>) => void = () => undefined;
  const state = {
    writesOn: options.writesOn ?? true,
    target: "target" in options ? options.target : TARGET,
    namespace: "velero" as string | undefined,
    now: 1_000,
    // What the main process answers a confirmation with, at once or when the test says.
    confirm: { ok: true, value: { token: "token-1", expires: 60_000 } } as
      | Answer<{ token: string; expires: number }>
      | Promise<Answer<{ token: string; expires: number }>>,
    // What the main process says of where a load is, at once or when the test says.
    status: { ok: true, value: { step: "wait", count: 2 } } as Answer<WriteStatus> | Promise<Answer<WriteStatus>>,
    pages: ["first page ", "second"] as (string | Failure)[],
    // What a page waits for before it is given, when a test holds one.
    atPage: undefined as ((page: number) => Promise<void> | undefined) | undefined,
    requests: 0,
    refused: 0,
  };
  const client: WriteClient & ArtifactClient = {
    confirm: async (cluster, namespace, kind, target, artifact) => {
      calls.push(`confirm ${cluster} ${namespace} ${kind} ${target?.name} ${artifact}`);
      return state.confirm;
    },
    runServerStatus: async () => failed("request-failed", "kind"),
    status: async (cluster, request) => {
      calls.push(`status ${cluster} ${request}`);
      return state.status;
    },
    cancel: async (cluster, request) => {
      calls.push(`cancel ${cluster} ${request}`);
      return { ok: true, value: null };
    },
    runDownload: (cluster, namespace, target, artifact, token, request) => {
      calls.push(`run ${cluster} ${namespace} ${target.name} ${artifact} ${token} ${request}`);
      return new Promise((resolve) => {
        answer = resolve;
        answers.push(resolve);
      });
    },
    page: async (cluster, request, page): Promise<Answer<ArtifactPage>> => {
      calls.push(`page ${cluster} ${request} ${page}`);
      await state.atPage?.(page);
      const text = state.pages[page];

      return typeof text === "string" ? { ok: true, value: { page, pages: state.pages.length, text } } : text;
    },
    release: async (cluster, request) => {
      calls.push(`release ${cluster} ${request}`);
      return { ok: true, value: null };
    },
    save: (cluster, request) => {
      calls.push(`save ${cluster} ${request}`);
      return new Promise((resolve) => {
        saved = resolve;
      });
    },
  };
  const load = new ArtifactLoad({
    ...(options.client === false ? {} : { client }),
    artifact: "BackupLog",
    cluster: () => "cluster-a",
    namespace: () => state.namespace,
    target: () => state.target,
    writesOn: () => state.writesOn,
    now: () => state.now,
    requestId: () => {
      state.requests += 1;
      return `request-${state.requests}`;
    },
    refused: () => {
      state.refused += 1;
    },
  });

  return {
    load,
    client,
    calls,
    state,
    answer: (value: Answer<ArtifactValue>) => answer(value),
    answers,
    // The dialog of the host is answered, and the tab is given the time to take what the main process says.
    saved: async (value: Answer<ArtifactSaved>) => {
      saved(value);
      await vi.advanceTimersByTimeAsync(0);
    },
    // A text that was asked, confirmed and loaded.
    loaded: async () => {
      await load.ask();
      const running = load.run();

      await vi.advanceTimersByTimeAsync(0);
      answer({ ok: true, value: VALUE });
      await running;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the load of an artifact, in the tab that shows it", () => {
  it("asks nothing when it is made, and nothing while writes are off or the object is not known", async () => {
    const { load, calls } = fixture();

    expect(load.step).toEqual({ state: "first" });
    expect(calls).toEqual([]);
    const off = fixture({ writesOn: false });

    await off.load.ask();
    expect(off.load.step).toEqual({ state: "first" });
    expect(off.calls).toEqual([]);
    const unknown = fixture({ target: undefined });

    await unknown.load.ask();
    expect(unknown.load.step).toEqual({ state: "first" });
    expect(unknown.calls).toEqual([]);
  });

  it("asks the confirmation of that artifact of that object, and creates nothing until it is run", async () => {
    const { load, calls } = fixture();

    await load.ask();
    expect(load.step).toEqual({ state: "confirming", token: "token-1", expires: 60_000 });
    expect(calls).toEqual(["confirm cluster-a velero DownloadRequest nightly BackupLog"]);
    // Left, it is the first state again, and nothing was created.
    load.leave();
    expect(load.step).toEqual({ state: "first" });
    expect(calls).toHaveLength(1);
  });

  it("runs the request, says the step the main process is at, and takes the pages of the text", async () => {
    const { load, calls, state, answer } = fixture();

    await load.ask();
    const running = load.run();

    await vi.advanceTimersByTimeAsync(0);
    expect(load.step).toEqual({ state: "loading", request: "request-1", step: "queue" });
    expect(calls.at(-1)).toBe("run cluster-a velero nightly BackupLog token-1 request-1");
    // Every 250 milliseconds the main process is asked where the load is, and not before.
    await vi.advanceTimersByTimeAsync(249);
    expect(calls.filter((call) => call.startsWith("status"))).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.filter((call) => call.startsWith("status"))).toHaveLength(1);
    expect(load.step).toEqual({ state: "loading", request: "request-1", step: "wait", count: 2 });
    state.status = { ok: true, value: { step: "download" } };
    await vi.advanceTimersByTimeAsync(250);
    expect(load.step).toEqual({ state: "loading", request: "request-1", step: "download" });
    expect(calls.filter((call) => call.startsWith("status"))).toHaveLength(2);
    // How the request ended is what the run answers, and no step of the load: until it does, the tab is at
    // the step it was at.
    for (const step of ["done", "failed: deadline"]) {
      state.status = { ok: true, value: { step } };
      await vi.advanceTimersByTimeAsync(250);
      expect(load.step).toEqual({ state: "loading", request: "request-1", step: "download" });
    }
    expect(calls.filter((call) => call.startsWith("status"))).toHaveLength(4);
    state.now = 5_000;
    answer({ ok: true, value: VALUE });
    await running;
    expect(load.step).toEqual({ state: "loaded", text: "first page second", value: VALUE, at: 5_000 });
    // The pages in their order. The main process keeps its copy while the view is open, for the command
    // that saves it: one copy in each process, and no more.
    expect(calls.slice(-2)).toEqual(["page cluster-a request-1 0", "page cluster-a request-1 1"]);
    expect(calls.some((call) => call.startsWith("release"))).toBe(false);
    expect(load.held).toBe("request-1");
    // Nothing is asked of the main process once the load ended.
    const asked = calls.length;

    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls).toHaveLength(asked);
  });

  it("asks the confirmation again when the one it shows expired, for the same artifact", async () => {
    const { load, calls, state, answer } = fixture();

    await load.ask();
    // At the moment it expires the token is good no more: the main process would refuse it.
    state.now = 60_000;
    state.confirm = { ok: true, value: { token: "token-2", expires: 120_000 } };
    const running = load.run();

    await vi.advanceTimersByTimeAsync(0);
    expect(calls.filter((call) => call.startsWith("confirm"))).toHaveLength(2);
    expect(calls.at(-1)).toBe("run cluster-a velero nightly BackupLog token-2 request-1");
    answer({ ok: true, value: { ...VALUE, pages: 0, size: 0 } });
    state.pages = [];
    await running;
    expect(load.step).toMatchObject({ state: "loaded", text: "" });
  });

  it("says how a load failed, with what the operator may allow, and tells the views that the gate may have changed", async () => {
    const { load, state, answer, calls } = fixture();
    const needs = { what: "private" as const, origin: "https://storage.example:9000" };

    await load.ask();
    const running = load.run();

    await vi.advanceTimersByTimeAsync(0);
    answer(failed("destination-denied", "route", { needs }));
    await running;
    expect(load.step).toEqual({
      state: "failed",
      failure: failed("destination-denied", "route", { needs }),
      at: 1_000,
    });
    expect(state.refused).toBe(1);
    expect(calls.some((call) => call.startsWith("page"))).toBe(false);
    // A confirmation that fails is said the same way, and creates nothing.
    const refused = fixture();

    refused.state.confirm = failed("forbidden", "gate");
    await refused.load.ask();
    expect(refused.load.step).toEqual({ state: "failed", failure: failed("forbidden", "gate"), at: 1_000 });
    expect(refused.calls).toHaveLength(1);
    // A page the main process does not give ends the load, and the text is let go there.
    const partial = fixture();

    partial.state.pages = ["first page ", failed("not-found", "delivery")];
    await partial.load.ask();
    const taking = partial.load.run();

    await vi.advanceTimersByTimeAsync(0);
    partial.answer({ ok: true, value: VALUE });
    await taking;
    expect(partial.load.step).toEqual({ state: "failed", failure: failed("not-found", "delivery"), at: 1_000 });
    expect(partial.calls.at(-1)).toBe("release cluster-a request-1");
  });

  it("cancels the request it runs, and says what the main process answers of it", async () => {
    const { load, calls, answer } = fixture();

    await load.ask();
    const running = load.run();

    await vi.advanceTimersByTimeAsync(0);
    await load.cancel();
    expect(calls.at(-1)).toBe("cancel cluster-a request-1");
    expect(load.step).toMatchObject({ state: "loading", cancelling: true });
    // Given again while the main process stops the request, the command asks nothing more.
    await load.cancel();
    expect(calls.filter((call) => call.startsWith("cancel"))).toHaveLength(1);
    answer(failed("cancelled", "wait", { retry: true }));
    await running;
    expect(load.step).toEqual({ state: "failed", failure: failed("cancelled", "wait", { retry: true }), at: 1_000 });
    // Nothing runs: a cancellation asks nothing.
    const asked = calls.length;

    await load.cancel();
    expect(calls).toHaveLength(asked);
  });

  it("stops taking the pages of a load that is cancelled meanwhile, lets the text go, and says that the request stays", async () => {
    for (const held of [0, 1]) {
      const { load, calls, state, answer } = fixture();
      let give: () => void = () => undefined;

      state.atPage = (page) =>
        page === held
          ? new Promise<void>((resolve) => {
              give = resolve;
            })
          : undefined;
      await load.ask();
      const running = load.run();

      await vi.advanceTimersByTimeAsync(0);
      answer({ ok: true, value: VALUE });
      await vi.advanceTimersByTimeAsync(0);
      expect(load.step).toEqual({ state: "loading", request: "request-1", step: "pages", count: held + 1, pages: 2 });
      await load.cancel();
      expect(load.step).toMatchObject({ state: "loading", step: "pages", cancelling: true });
      give();
      await running;
      // The request was created, and ran to its end: the words are the ones of a download that was
      // cancelled after that, which say what stays in the cluster.
      const cancelled = downloadFailure("cancelled", "delivery", {
        artifact: "BackupLog",
        name: "nightly",
        namespace: "velero",
        request: "nightly-request-1",
      });

      expect(load.step).toEqual({ state: "failed", failure: cancelled, at: 1_000 });
      expect(cancelled.text).toBe(
        "The download was cancelled. The DownloadRequest nightly-request-1 stays in velero until Velero removes it.",
      );
      expect(cancelled.retry).toBe(true);
      // No page is asked after the one that was on its way, the text is let go in the main process, and
      // none of it is held or shown here.
      expect(calls.filter((call) => call.startsWith("page"))).toHaveLength(held + 1);
      expect(calls.at(-1)).toBe("release cluster-a request-1");
      expect([load.held, load.shown, load.savable]).toEqual([undefined, undefined, false]);
    }
  });

  it("creates nothing when a load is cancelled while its confirmation is renewed", async () => {
    const { load, calls, state, loaded } = fixture();
    let renew: (answer: Answer<{ token: string; expires: number }>) => void = () => undefined;

    await loaded();
    const text = load.step;

    await load.ask();
    // The confirmation was read for longer than it lasts: the second gesture asks for another one first.
    state.now = 61_000;
    state.confirm = new Promise((resolve) => {
      renew = resolve;
    });
    const running = load.run();

    await vi.advanceTimersByTimeAsync(0);
    expect(load.step).toEqual({ state: "loading", request: "request-2", step: "queue" });
    await load.cancel();
    expect(load.step).toMatchObject({ state: "loading", cancelling: true });
    renew({ ok: true, value: { token: "token-2", expires: 120_000 } });
    await vi.advanceTimersByTimeAsync(0);
    // Nothing was created, and nothing went: the tab is where it was, with the text it showed.
    expect(calls.some((call) => call.startsWith("run cluster-a velero nightly BackupLog token-2"))).toBe(false);
    expect(calls.filter((call) => call.startsWith("run"))).toHaveLength(1);
    await running;
    expect(calls.some((call) => call.startsWith("release"))).toBe(false);
    expect(load.step).toBe(text);
    expect([load.held, load.savable]).toEqual(["request-1", true]);
    // A tab that showed nothing is at its first state.
    const first = fixture();

    await first.load.ask();
    first.state.now = 61_000;
    first.state.confirm = new Promise((resolve) => {
      renew = resolve;
    });
    const again = first.load.run();

    await vi.advanceTimersByTimeAsync(0);
    await first.load.cancel();
    renew({ ok: true, value: { token: "token-2", expires: 120_000 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(first.calls.some((call) => call.startsWith("run"))).toBe(false);
    expect(first.load.step).toEqual({ state: "first" });
    await again;
    // A confirmation that is refused when it is renewed keeps the text as well.
    const refused = fixture();

    await refused.loaded();
    const kept = refused.load.step;

    await refused.load.ask();
    refused.state.now = 61_000;
    refused.state.confirm = failed("forbidden", "gate");
    await refused.load.run();
    expect(refused.load.step).toEqual({
      state: "failed",
      failure: failed("forbidden", "gate"),
      at: 61_000,
      over: kept,
    });
    expect(refused.load.held).toBe("request-1");
  });

  it("takes nothing of a text the main process does not give as it said it held it", async () => {
    const words = notTheText("nightly-request-1", "velero");
    const refused = { ok: false, code: "artifact-invalid", stage: "delivery", retry: false, text: words };
    // What is answered for a page, by the page that is asked.
    const cases: [string, (page: number) => ArtifactPage, number][] = [
      // The page that is answered is not the one that was asked.
      ["another page", (page) => ({ page: page === 1 ? 0 : page, pages: 2, text: "first page " }), 2],
      // The text has another count of pages than the one the load was answered with.
      ["another count", (page) => ({ page, pages: 3, text: "first page " }), 1],
    ];

    for (const [name, give, asked] of cases) {
      const { load, calls, client, answer } = fixture();

      client.page = async (cluster, request, page) => {
        calls.push(`page ${cluster} ${request} ${page}`);
        return { ok: true, value: give(page) };
      };
      await load.ask();
      const running = load.run();

      await vi.advanceTimersByTimeAsync(0);
      answer({ ok: true, value: VALUE });
      await running;
      expect([name, load.step]).toEqual([name, { state: "failed", failure: refused, at: 1_000 }]);
      expect([name, calls.filter((call) => call.startsWith("page")).length]).toEqual([name, asked]);
      // The text is let go in the main process, and none of it is held or shown here.
      expect([name, calls.at(-1)]).toEqual([name, "release cluster-a request-1"]);
      expect([name, load.held, load.shown]).toEqual([name, undefined, undefined]);
    }
  });

  it("takes no more of a text than an artifact has, however many pages the main process says there are", async () => {
    const { load, calls, client, answer } = fixture();
    // A page as large as a page is, given for every page that is asked, of more pages than any text has.
    const full = "x".repeat(PAGE_BOUND);
    const pages = Number.MAX_SAFE_INTEGER;

    expect(ARTIFACT_TEXT_BOUND).toBe(64 * 1024 ** 2);
    client.page = async (cluster, request, page) => {
      calls.push(`page ${cluster} ${request} ${page}`);
      return { ok: true, value: { page, pages, text: full } };
    };
    await load.ask();
    const running = load.run();

    await vi.advanceTimersByTimeAsync(0);
    answer({ ok: true, value: { ...VALUE, size: 11, pages } });
    await running;
    expect(load.step).toMatchObject({
      state: "failed",
      failure: { code: "artifact-invalid", stage: "delivery", text: notTheText("nightly-request-1", "velero") },
    });
    // Sixteen pages are an artifact of the largest size: the one after them is the last that is asked.
    expect(calls.filter((call) => call.startsWith("page"))).toHaveLength(ARTIFACT_TEXT_BOUND / PAGE_BOUND + 1);
    expect(calls.at(-1)).toBe("release cluster-a request-1");
    expect([load.held, load.shown]).toEqual([undefined, undefined]);
  });

  it("drops what it holds, takes nothing that arrives after, and cancels what it was running", async () => {
    const { load, calls, answer } = fixture();

    await load.ask();
    const running = load.run();

    await vi.advanceTimersByTimeAsync(0);
    load.drop();
    expect(load.step).toEqual({ state: "first" });
    expect(calls.at(-1)).toBe("cancel cluster-a request-1");
    // The answer of the run that was dropped is not taken; the text the main process holds for it is let go.
    answer({ ok: true, value: VALUE });
    await running;
    expect(load.step).toEqual({ state: "first" });
    expect(calls.at(-1)).toBe("release cluster-a request-1");
    expect(calls.some((call) => call.startsWith("page"))).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls.filter((call) => call.startsWith("status"))).toHaveLength(0);
    // A text that was loaded goes with a load that begins again, here and in the main process: when the
    // new request is created, which is the second gesture, and not when its confirmation is asked.
    const loaded = fixture();

    await loaded.loaded();
    const text = loaded.load.step;

    expect(text.state).toBe("loaded");
    await loaded.load.ask();
    expect(loaded.load.step).toEqual({ state: "confirming", token: "token-1", expires: 60_000, over: text });
    expect(loaded.load.shown).toBe(text);
    expect(loaded.calls.some((call) => call.startsWith("release"))).toBe(false);
    expect(loaded.load.held).toBe("request-1");
    const again = loaded.load.run();

    await vi.advanceTimersByTimeAsync(0);
    expect(loaded.load.step).toEqual({ state: "loading", request: "request-2", step: "queue" });
    expect(loaded.load.shown).toBeUndefined();
    expect(loaded.load.held).toBeUndefined();
    // The text of the load before is let go before the new request is run.
    expect(loaded.calls.slice(-2)).toEqual([
      "release cluster-a request-1",
      "run cluster-a velero nightly BackupLog token-1 request-2",
    ]);
    loaded.load.drop();
    expect(loaded.load.step).toEqual({ state: "first" });
    loaded.answer({ ok: true, value: VALUE });
    await again;
    // And with a drop: the view closed, or the installation changed.
    const closed = fixture();

    await closed.load.ask();
    const second = closed.load.run();

    await vi.advanceTimersByTimeAsync(0);
    closed.answer({ ok: true, value: VALUE });
    await second;
    closed.load.drop();
    expect(closed.load.step).toEqual({ state: "first" });
    expect(closed.calls.at(-1)).toBe("release cluster-a request-1");
    // Dropped again, nothing more is asked.
    const asked = closed.calls.length;

    closed.load.drop();
    expect(closed.calls).toHaveLength(asked);
  });

  it("keeps the text it loaded when a load again is not confirmed: nothing was created, and nothing is let go", async () => {
    const { load, calls, state, loaded } = fixture();

    await loaded();
    const text = load.step;
    const asked = calls.length;

    // The confirmation is left: the tab shows what it showed, and can save it.
    await load.ask();
    expect(load.step.state).toBe("confirming");
    expect(load.savable).toBe(false);
    load.leave();
    expect(load.step).toBe(text);
    expect([load.held, load.savable, load.shown]).toEqual(["request-1", true, text]);
    expect(calls.slice(asked)).toEqual(["confirm cluster-a velero DownloadRequest nightly BackupLog"]);
    // Writes go off while the confirmation is shown: the second gesture creates nothing, and the text stays.
    await load.ask();
    state.writesOn = false;
    void load.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(load.step.state).toBe("confirming");
    expect(calls.filter((call) => call.startsWith("run"))).toHaveLength(1);
    load.leave();
    expect(load.step).toBe(text);
    state.writesOn = true;
    // The main process refuses the confirmation: the text is still the one the tab holds, under the
    // words of the refusal, and what follows the refusal begins from it.
    state.confirm = failed("forbidden", "gate");
    await load.ask();
    expect(load.step).toEqual({ state: "failed", failure: failed("forbidden", "gate"), at: 1_000, over: text });
    expect([load.shown, load.held]).toEqual([text, "request-1"]);
    expect(calls.some((call) => call.startsWith("release"))).toBe(false);
    // It is asked again from there, over the same text.
    state.confirm = { ok: true, value: { token: "token-2", expires: 60_000 } };
    await load.ask();
    expect(load.step).toEqual({ state: "confirming", token: "token-2", expires: 60_000, over: text });
    // The view closes: the text goes with it, whatever the tab was at.
    load.drop();
    expect([load.step, load.shown, load.held]).toEqual([{ state: "first" }, undefined, undefined]);
    expect(calls.at(-1)).toBe("release cluster-a request-1");
  });

  it("is taken back to where it was before a load that ended without its text, and asks nothing for it", async () => {
    const { load, calls, state, answer, loaded } = fixture();

    // Nothing is taken back of a tab that is not at a load that failed.
    load.reset();
    expect(load.step).toEqual({ state: "first" });
    await load.ask();
    load.reset();
    expect(load.step.state).toBe("confirming");
    const running = load.run();

    await vi.advanceTimersByTimeAsync(0);
    load.reset();
    expect(load.step.state).toBe("loading");
    // The load ends without its text: when it did is kept with how.
    state.now = 7_000;
    answer(failed("artifact-missing", "download"));
    await running;
    expect(load.step).toEqual({ state: "failed", failure: failed("artifact-missing", "download"), at: 7_000 });
    const asked = calls.length;

    load.reset();
    expect(load.step).toEqual({ state: "first" });
    expect(calls).toHaveLength(asked);
    // From there the tab is asked as it was the first time.
    await load.ask();
    expect(load.step.state).toBe("confirming");
    load.leave();
    // A confirmation the main process refused over a text that is shown: the tab goes back to the text.
    await loaded();
    const text = load.step;

    load.reset();
    expect(load.step).toBe(text);
    state.confirm = failed("target-changed", "connection");
    await load.ask();
    expect(load.step).toMatchObject({ state: "failed", over: text });
    const before = calls.length;

    load.reset();
    expect(load.step).toBe(text);
    expect([load.held, load.savable]).toEqual(["request-2", true]);
    expect(calls).toHaveLength(before);
  });

  it("asks one confirmation at a time, and none while its request runs", async () => {
    const { load, calls, state, answer } = fixture();
    const confirmations = () => calls.filter((call) => call.startsWith("confirm"));
    let confirm: (answer: Answer<{ token: string; expires: number }>) => void = () => undefined;

    // The first gesture is given twice while the main process is asked: one confirmation is asked.
    state.confirm = new Promise((resolve) => {
      confirm = resolve;
    });
    const asking = load.ask();

    void load.ask();
    await vi.advanceTimersByTimeAsync(0);
    expect(confirmations()).toHaveLength(1);
    confirm({ ok: true, value: { token: "token-1", expires: 60_000 } });
    await asking;
    const shown = load.step;

    expect(shown).toEqual({ state: "confirming", token: "token-1", expires: 60_000 });
    // Given again over the confirmation that is shown, it asks nothing: the token is the one that is shown.
    state.confirm = { ok: true, value: { token: "token-2", expires: 60_000 } };
    await load.ask();
    expect(confirmations()).toHaveLength(1);
    expect(load.step).toBe(shown);
    // And while the request runs: a load is cancelled, or it ends.
    const running = load.run();

    await vi.advanceTimersByTimeAsync(0);
    await load.ask();
    expect(confirmations()).toHaveLength(1);
    expect(load.step).toEqual({ state: "loading", request: "request-1", step: "queue" });
    answer(failed("cancelled", "wait", { retry: true }));
    await running;
  });

  it("takes nothing of a confirmation that answers after it was left, even when it was asked again meanwhile", async () => {
    const { load, state } = fixture();
    const answers: ((answer: Answer<{ token: string; expires: number }>) => void)[] = [];
    const later = () =>
      new Promise<Answer<{ token: string; expires: number }>>((resolve) => {
        answers.push(resolve);
      });

    state.confirm = later();
    void load.ask();
    expect(load.step).toEqual({ state: "asking" });
    // The confirmation is left while it is asked, as it is when writes go off: the tab is where it was.
    load.leave();
    expect(load.step).toEqual({ state: "first" });
    // It is asked again, and the first one answers late: its token is not of the confirmation that is
    // asked now, which is the one the tab waits for.
    state.confirm = later();
    void load.ask();
    answers[0]({ ok: true, value: { token: "token-1", expires: 60_000 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(load.step).toEqual({ state: "asking" });
    answers[1]({ ok: true, value: { token: "token-2", expires: 60_000 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(load.step).toEqual({ state: "confirming", token: "token-2", expires: 60_000 });
    // Left and not asked again, the tab shows nothing of what the main process answers, and nothing of a
    // refusal: no gate is asked for it.
    for (const late of [
      { ok: true as const, value: { token: "token-3", expires: 60_000 } },
      failed("forbidden", "gate"),
    ]) {
      load.leave();
      state.confirm = later();
      void load.ask();
      load.leave();
      answers.at(-1)?.(late);
      await vi.advanceTimersByTimeAsync(0);
      expect([load.step, state.refused]).toEqual([{ state: "first" }, 0]);
    }
  });

  it("creates no request but from the confirmation it shows, for a namespace and an object the view still knows", async () => {
    const runs = (calls: string[]) => calls.filter((call) => call.startsWith("run"));
    // The second gesture at a tab that shows no confirmation asks nothing.
    const first = fixture();

    void first.load.run();
    await vi.advanceTimersByTimeAsync(0);
    expect([first.load.step, first.calls]).toEqual([{ state: "first" }, []]);
    // The view lost the namespace of the installation, then the object, while the confirmation was shown.
    const lost = fixture();

    await lost.load.ask();
    const shown = lost.load.step;

    lost.state.namespace = undefined;
    void lost.load.run();
    await vi.advanceTimersByTimeAsync(0);
    expect([lost.load.step, runs(lost.calls)]).toEqual([shown, []]);
    lost.state.namespace = "velero";
    lost.state.target = undefined;
    // What a request without its object would raise is not what this looks at.
    void lost.load.run().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect([lost.load.step, runs(lost.calls)]).toEqual([shown, []]);
  });

  it("creates nothing, and says nothing, of a load that was dropped while its confirmation was renewed", async () => {
    for (const renewed of [
      { ok: true as const, value: { token: "token-2", expires: 120_000 } },
      failed("forbidden", "gate"),
    ]) {
      const { load, calls, state } = fixture();
      let renew: (answer: Answer<{ token: string; expires: number }>) => void = () => undefined;

      await load.ask();
      state.now = 61_000;
      state.confirm = new Promise((resolve) => {
        renew = resolve;
      });
      void load.run();
      await vi.advanceTimersByTimeAsync(0);
      expect(load.step.state).toBe("loading");
      // The view closes while the main process is asked for the other confirmation.
      load.drop();
      renew(renewed);
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.filter((call) => call.startsWith("run"))).toEqual([]);
      expect([load.step, state.refused]).toEqual([{ state: "first" }, 0]);
    }
  });

  it("gives the answer of a load that was dropped to no load that runs in its place", async () => {
    const { load, calls, answers } = fixture();
    const pages = () => calls.filter((call) => call.startsWith("page"));

    await load.ask();
    void load.run();
    await vi.advanceTimersByTimeAsync(0);
    load.drop();
    await load.ask();
    const running = load.run();

    await vi.advanceTimersByTimeAsync(0);
    expect(load.step).toEqual({ state: "loading", request: "request-2", step: "queue" });
    // The main process answers the first request, whose text it had before it was told to stop: the tab
    // takes no page of it and lets it go, and is still at the request that runs.
    answers[0]({ ok: true, value: VALUE });
    await vi.advanceTimersByTimeAsync(0);
    expect(load.step).toEqual({ state: "loading", request: "request-2", step: "queue" });
    expect(pages()).toEqual([]);
    expect(calls.at(-1)).toBe("release cluster-a request-1");
    // The second is answered: its text is the one that is shown, and held.
    answers[1]({ ok: true, value: VALUE });
    await running;
    expect(load.step).toMatchObject({ state: "loaded", text: "first page second" });
    expect(load.held).toBe("request-2");
    expect(pages()).toEqual(["page cluster-a request-2 0", "page cluster-a request-2 1"]);
  });

  it("shows nothing of a step the main process says after the load ended, with its text or without it", async () => {
    for (const end of [{ ok: true as const, value: VALUE }, failed("deadline", "wait", { retry: true })]) {
      const { load, state, answer } = fixture();
      let say: (status: Answer<WriteStatus>) => void = () => undefined;

      await load.ask();
      const running = load.run();

      await vi.advanceTimersByTimeAsync(0);
      // The main process is asked where the load is, and says it once the load ended.
      state.status = new Promise((resolve) => {
        say = resolve;
      });
      await vi.advanceTimersByTimeAsync(250);
      answer(end);
      await running;
      const ended = load.step;

      expect(ended.state).toBe(end.ok ? "loaded" : "failed");
      say({ ok: true, value: { step: "wait", count: 2 } });
      await vi.advanceTimersByTimeAsync(0);
      expect(load.step).toBe(ended);
    }
  });

  it("takes no more, and shows nothing, of a load that was dropped while a page was on its way", async () => {
    for (const page of ["first page ", failed("not-found", "delivery")]) {
      const { load, calls, state, answer } = fixture();
      let give: () => void = () => undefined;

      state.pages = [page, "second"];
      state.atPage = (asked) =>
        asked === 0
          ? new Promise<void>((resolve) => {
              give = resolve;
            })
          : undefined;
      await load.ask();
      const running = load.run();

      await vi.advanceTimersByTimeAsync(0);
      answer({ ok: true, value: VALUE });
      await vi.advanceTimersByTimeAsync(0);
      expect(load.step).toMatchObject({ state: "loading", step: "pages" });
      // The view closes, and the page arrives after: given or refused, the tab is where the drop left it,
      // no other page is asked, and the text is let go in the main process.
      load.drop();
      give();
      await running;
      expect([load.step, load.held, state.refused]).toEqual([{ state: "first" }, undefined, 0]);
      expect(calls.filter((call) => call.startsWith("page"))).toEqual(["page cluster-a request-1 0"]);
      expect(calls.at(-1)).toBe("release cluster-a request-1");
    }
  });

  it("says that there is no way to the main process where there is none", async () => {
    const { load } = fixture({ client: false });

    await load.ask();
    expect(load.step).toMatchObject({ state: "failed", failure: { code: "request-failed", stage: "way" } });
  });

  it("leaves a confirmation when writes go off, and keeps what was loaded", async () => {
    const { load, calls, state } = fixture();

    await load.ask();
    state.writesOn = false;
    void load.run();
    await vi.advanceTimersByTimeAsync(0);
    // The second gesture creates nothing with writes off: the confirmation is still what the tab shows.
    expect(load.step.state).toBe("confirming");
    expect(calls.filter((call) => call.startsWith("run"))).toEqual([]);
    load.leave();
    expect(load.step).toEqual({ state: "first" });
  });
});

describe("the saving of the text a tab holds", () => {
  const saves = (calls: string[]) => calls.filter((call) => call.startsWith("save"));

  it("is not offered, and asks nothing, until a text is loaded and held", async () => {
    const { load, calls, answer } = fixture();

    expect(load.saving).toEqual({ state: "none" });
    expect(load.savable).toBe(false);
    await load.save();
    await load.ask();
    expect(load.savable).toBe(false);
    await load.save();
    const running = load.run();

    await vi.advanceTimersByTimeAsync(0);
    expect(load.savable).toBe(false);
    await load.save();
    answer(failed("deadline", "wait", { retry: true }));
    await running;
    expect(load.savable).toBe(false);
    await load.save();
    expect(saves(calls)).toEqual([]);
    expect(load.saving).toEqual({ state: "none" });
  });

  it("asks the main process to save the text it holds, one saving at a time, and says whether a file was written", async () => {
    const { load, calls, state, loaded, saved } = fixture();

    await loaded();
    expect(load.savable).toBe(true);
    void load.save();
    // The text is named by its cluster and its request, and by nothing of a file: the dialog is of the host.
    expect(saves(calls)).toEqual(["save cluster-a request-1"]);
    expect(load.saving).toEqual({ state: "asked" });
    // While the dialog is open the command is not offered, and given again it asks nothing.
    expect(load.savable).toBe(false);
    void load.save();
    expect(saves(calls)).toHaveLength(1);
    await saved({ ok: true, value: { saved: true } });
    expect(load.saving).toEqual({ state: "saved" });
    expect(load.savable).toBe(true);
    // The operator closes the dialog of a second saving: nothing was written, and that is said.
    void load.save();
    expect(load.saving).toEqual({ state: "asked" });
    await saved({ ok: true, value: { saved: false } });
    expect(load.saving).toEqual({ state: "left" });
    expect(saves(calls)).toHaveLength(2);
    // What the saving is at is what the words of the tab are given.
    expect(savingText("log", load.saving)).toBe("No file was chosen: the log was not saved, and nothing was written.");
    // Saving lets nothing go, changes nothing of the load, and is no matter of the gate.
    expect(load.step.state).toBe("loaded");
    expect(load.held).toBe("request-1");
    expect(calls.some((call) => call.startsWith("release"))).toBe(false);
    expect(state.refused).toBe(0);
  });

  it("says why a file was not written, in the words of the main process, and offers no text the main process let go", async () => {
    const { load, calls, state, loaded, saved } = fixture();
    const unwritten = failed("request-failed", "save", { retry: true });
    const gone = failed("not-found", "delivery");

    await loaded();
    void load.save();
    await saved(unwritten);
    expect(load.saving).toEqual({ state: "failed", failure: unwritten });
    // The text is still held: another file may be chosen.
    expect(load.held).toBe("request-1");
    expect(load.savable).toBe(true);
    void load.save();
    await saved(gone);
    expect(load.saving).toEqual({ state: "failed", failure: gone });
    // The main process holds the text no more: what was loaded stays shown, and is not offered to be saved.
    expect(load.step.state).toBe("loaded");
    expect(load.held).toBeUndefined();
    expect(load.savable).toBe(false);
    await load.save();
    expect(saves(calls)).toHaveLength(2);
    expect(state.refused).toBe(0);
    // The time the text was to be held for ends later: it is the time of a text that went before it, and
    // the tab does not say of it that it passed.
    await vi.advanceTimersByTimeAsync(ARTIFACT_HOLD_MS);
    expect(load.expired).toBe(false);
    // Nothing is held there to let go when the view closes.
    load.drop();
    expect(calls.some((call) => call.startsWith("release"))).toBe(false);
  });

  it("takes nothing of a saving that answers after the load was dropped, or began again", async () => {
    const dropped = fixture();

    await dropped.loaded();
    void dropped.load.save();
    dropped.load.drop();
    expect(dropped.load.saving).toEqual({ state: "none" });
    await dropped.saved({ ok: true, value: { saved: true } });
    expect(dropped.load.saving).toEqual({ state: "none" });
    // A load that begins again is of another text: the dialog of the one before says nothing of it. The
    // text goes when the new request is created, and so does what was said of its saving.
    const again = fixture();

    await again.loaded();
    void again.load.save();
    await again.load.ask();
    expect(again.load.saving).toEqual({ state: "asked" });
    void again.load.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(again.load.saving).toEqual({ state: "none" });
    await again.saved(failed("request-failed", "save", { retry: true }));
    expect(again.load.saving).toEqual({ state: "none" });
    // What was said of a saving that ended goes with the text it was of, and stays while that text does.
    const ended = fixture();

    await ended.loaded();
    void ended.load.save();
    await ended.saved({ ok: true, value: { saved: true } });
    expect(ended.load.saving).toEqual({ state: "saved" });
    await ended.load.ask();
    expect(ended.load.saving).toEqual({ state: "saved" });
    ended.load.leave();
    expect(ended.load.saving).toEqual({ state: "saved" });
    await ended.load.ask();
    void ended.load.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(ended.load.saving).toEqual({ state: "none" });
  });

  it("asks nothing where there is no way to the main process", async () => {
    const { load } = fixture({ client: false });

    await load.save();
    expect(load.saving).toEqual({ state: "none" });
    expect(load.savable).toBe(false);
  });

  it("knows until when the main process holds the text, and offers to save it no longer than that", async () => {
    const { load, calls, state, answer } = fixture();

    await load.ask();
    const running = load.run();

    await vi.advanceTimersByTimeAsync(0);
    // The main process holds the text from the moment it answers that it has it, before the pages are
    // taken: each of the two takes a second here, and the time is not counted from the last of them.
    state.now = 5_000;
    state.atPage = () => {
      state.now += 1_000;
      return undefined;
    };
    answer({ ok: true, value: VALUE });
    await running;
    expect(load.step).toMatchObject({ state: "loaded", at: 7_000 });
    expect(load.heldUntil).toBe(5_000 + ARTIFACT_HOLD_MS);
    expect(load.expired).toBe(false);
    expect(load.savable).toBe(true);
    // The offer lasts for what is left of that time, and reading the text does not make the main process
    // hold it for longer.
    await vi.advanceTimersByTimeAsync(ARTIFACT_HOLD_MS - 2_000 - 1);
    expect(load.savable).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(load.savable).toBe(false);
    expect(load.expired).toBe(true);
    expect(load.held).toBeUndefined();
    // When it was held until is still known, for the words that say so, and the text stays shown.
    expect(load.heldUntil).toBe(5_000 + ARTIFACT_HOLD_MS);
    expect(load.step).toMatchObject({ state: "loaded", text: "first page second" });
    // The command asks nothing any more, and nothing is asked of a text the main process let go itself.
    await load.save();
    expect(saves(calls)).toEqual([]);
    expect(calls.some((call) => call.startsWith("release"))).toBe(false);
    load.drop();
    expect(calls.some((call) => call.startsWith("release"))).toBe(false);
    expect([load.heldUntil, load.expired]).toEqual([undefined, false]);
  });

  it("does not say of a text that it is held no more when the text went first, with its load or with another", async () => {
    const dropped = fixture();

    await dropped.loaded();
    dropped.load.drop();
    await vi.advanceTimersByTimeAsync(ARTIFACT_HOLD_MS);
    expect([dropped.load.expired, dropped.load.heldUntil]).toEqual([false, undefined]);
    // A text loaded again is held from its own load: the time of the one before does not end it.
    const again = fixture();

    await again.loaded();
    await vi.advanceTimersByTimeAsync(ARTIFACT_HOLD_MS - 1_000);
    await again.load.ask();
    const running = again.load.run();

    await vi.advanceTimersByTimeAsync(0);
    again.state.now = 700_000;
    again.answer({ ok: true, value: VALUE });
    await running;
    await vi.advanceTimersByTimeAsync(1_000);
    expect([again.load.expired, again.load.savable, again.load.held]).toEqual([false, true, "request-2"]);
    expect(again.load.heldUntil).toBe(700_000 + ARTIFACT_HOLD_MS);
    // A saving whose dialog is open when the time ends is still answered by the main process, which wrote
    // the bytes it took when it was asked.
    const open = fixture();

    await open.loaded();
    void open.load.save();
    await vi.advanceTimersByTimeAsync(ARTIFACT_HOLD_MS);
    expect([open.load.expired, open.load.saving.state]).toEqual([true, "asked"]);
    await open.saved({ ok: true, value: { saved: true } });
    expect(open.load.saving).toEqual({ state: "saved" });
    expect(open.load.savable).toBe(false);
  });
});
