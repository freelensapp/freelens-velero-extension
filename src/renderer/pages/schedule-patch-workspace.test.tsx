// @vitest-environment jsdom

// The workspace of a pause and of a resume of a schedule (SPEC-0017, PAUSE-01, PAUSE-04 in the component layer): Pause
// on a schedule that is not paused and Resume on one that is, never both, each opening its workspace over the view of
// the schedule and writing nothing by itself; the choice of skipping a run proposed as the schedule carries it; the
// review of the patch beside what it means; the schedule read after the patch; and the ends of a patch that failed.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_VERSION_RESOURCES } from "../../../test/discovery";
import { confirmDialogs } from "../../../test/host-components";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { patchText, pausePatch, resumePatch } from "../../common/schedule-patch";
import { SCHEDULE_PATCH_VIEW_WORDS } from "../../common/schedule-patch-words";
import { closeViews, openView, openViews } from "../navigation";
import { Installation } from "../state/installation";
import { SchedulesPage } from "./schedules-page";

import type { Answer, Family } from "../../common/discovery";
import type { Failure, GateState, Answer as IpcAnswer, ScheduleChanged, WriteConfirmAnswer } from "../../common/ipc";
import type {
  ArtifactClient,
  BackupCreateClient,
  BackupNowClient,
  GateClient,
  KeptEndsClient,
  RestoreCreateClient,
  ScheduleCreateClient,
  SchedulePatchClient,
  WriteClient,
} from "../api/ipc";

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";
const A = "velero-a";
// 2026-11-08 04:30:15 UTC.
const NOW = Date.UTC(2026, 10, 8, 4, 30, 15);
const EXPRESSION = "TZ=UTC 0 3 * * *";

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

const schedule = (name: string, spec: object = {}, status: object = { phase: "Enabled" }) => ({
  apiVersion: "velero.io/v1",
  kind: "Schedule",
  metadata: { name, namespace: A, uid: `${name}-uid`, creationTimestamp: "2026-08-01T00:00:00Z" },
  spec: { schedule: EXPRESSION, template: { includedNamespaces: ["shop"] }, ...spec },
  status,
});

function answers(): Record<string, Answer> {
  return {
    [DISCOVERY]: { status: 200, body: { resources: FIRST_VERSION_RESOURCES.map((name) => ({ name })) } },
    [LOCATIONS]: list(),
    [path("backups", A)]: list(),
    [path("restores", A)]: list(),
    [path("schedules", A)]: list(
      // Paused two days after its last backup: the run of yesterday is due at a resume.
      schedule(
        "nightly",
        { paused: true, skipImmediately: true },
        { phase: "Enabled", lastBackup: "2026-11-06T03:00:41Z" },
      ),
      schedule("weekly", held.weeklyPaused ? { paused: true } : {}),
      schedule("bare", { paused: true }, { phase: "Enabled", lastBackup: "2026-11-06T03:00:41Z" }),
      // A schedule whose read reports no expression, which a resume tests.
      schedule("blank", { paused: true, schedule: undefined }),
    ),
    [path("storageLocations", A)]: list(),
    [path("snapshotLocations", A)]: list(),
  };
}

const PAUSE = patchText(pausePatch("weekly-uid"));
const resumeText = (skipImmediately: boolean) =>
  patchText(resumePatch("nightly-uid", { expression: EXPRESSION, skipImmediately }));
const NOTHING: Failure = { ok: false, code: "request-failed", stage: "request", retry: false, text: "Not asked." };

// Whether the cluster holds weekly paused, as the views read it at their next read.
const held = { weeklyPaused: false };

// The main process: the gate, and the confirmations and runs of a patch, which wait until the test answers them.
function mainProcess() {
  let state: GateState = {
    cluster: { id: "cluster-a", name: "local-demo", context: "kind-local-demo" },
    writes: { on: false },
  };
  const confirms: { args: unknown[]; answer: (answer: IpcAnswer<WriteConfirmAnswer>) => void }[] = [];
  const runs: { args: unknown[]; answer: (answer: IpcAnswer<ScheduleChanged>) => void }[] = [];
  const gate: GateClient = {
    state: async () => ({ ok: true, value: state }),
    enable: async (_cluster, namespace) => {
      state = { ...state, writes: { on: true, namespace, since: NOW } };
      return { ok: true, value: state };
    },
    disable: async () => {
      state = { ...state, writes: { on: false } };
      return { ok: true, value: state };
    },
    onChanged: () => () => undefined,
  };
  const writer: WriteClient & ArtifactClient = {
    confirm: async () => NOTHING,
    runServerStatus: async () => NOTHING,
    status: async () => NOTHING,
    cancel: async () => NOTHING,
    runDownload: async () => NOTHING,
    page: async () => NOTHING,
    release: async () => NOTHING,
    save: async () => NOTHING,
  };
  const shown: string[] = [];
  const keptEnds: KeptEndsClient = {
    ends: async () => ({ ok: true, value: [] }),
    shown: async (_cluster, request) => {
      shown.push(request);
      return { ok: true, value: null };
    },
  };
  const actions: BackupNowClient &
    BackupCreateClient &
    ScheduleCreateClient &
    RestoreCreateClient &
    SchedulePatchClient = {
    confirmBackupNow: async () => NOTHING,
    runBackupNow: async () => NOTHING,
    confirmBackupCreate: async () => NOTHING,
    runBackupCreate: async () => NOTHING,
    confirmScheduleCreate: async () => NOTHING,
    runScheduleCreate: async () => NOTHING,
    confirmRestoreCreate: async () => NOTHING,
    runRestoreCreate: async () => NOTHING,
    confirmSchedulePatch: (...args) => new Promise((answer) => confirms.push({ args, answer })),
    runSchedulePatch: (...args) => new Promise((answer) => runs.push({ args, answer })),
  };
  const settle = async <Value,>(
    held: { answer: (answer: IpcAnswer<Value>) => void } | undefined,
    answer: IpcAnswer<Value>,
  ) => {
    if (!held) throw new Error("Nothing waits");
    await act(async () => {
      held.answer(answer);
      await new Promise((done) => setTimeout(done, 0));
    });
  };

  return {
    gate,
    writer,
    actions,
    keptEnds,
    shown,
    confirms,
    runs,
    confirm: (text: string) =>
      settle(confirms.at(-1), { ok: true, value: { token: `token-${confirms.length}`, expires: NOW + 30_000, text } }),
    run: (answer: IpcAnswer<ScheduleChanged>) => settle(runs.at(-1), answer),
  };
}

function mount(main = mainProcess()) {
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => answers()[address] ?? { status: 404 },
    now: () => Date.now(),
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": A } }),
    gate: main.gate,
    writer: main.writer,
    actions: main.actions,
    keptEnds: main.keptEnds,
  });
  const view = render(<SchedulesPage installation={installation} />);

  return { installation, main, view };
}

const part = (id: string) => screen.getByTestId(`velero-schedule-patch-${id}`);
const maybe = (id: string) => screen.queryByTestId(`velero-schedule-patch-${id}`);
const focused = () => document.activeElement?.getAttribute("data-testid");
const press = (id: string) => {
  act(() => part(id).focus());
  fireEvent.click(part(id));
};

// The words of a part, without the names of its marks, which the host draws as icons.
function words(element: Element): string {
  const copy = element.cloneNode(true) as Element;

  for (const mark of copy.querySelectorAll(".Icon")) mark.remove();
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

async function openSchedule(name: string) {
  await waitFor(() => expect(screen.getByText(name, { selector: "[data-schedule-row]" })).toBeTruthy());
  fireEvent.click(screen.getByText(name, { selector: "[data-schedule-row]" }));
  await screen.findByTestId("velero-schedule-workspace");
}

async function writesOn() {
  await waitFor(() => expect(screen.getByTestId("velero-writes-on")).toBeTruthy());
  fireEvent.click(screen.getByTestId("velero-writes-on"));
  await act(async () => {
    await confirmDialogs.at(-1)?.ok?.();
  });
  await waitFor(() => expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("on"));
}

// The workspace of the action, from the command of the view of the schedule.
async function action(name: string, command: "pause" | "resume") {
  await openSchedule(name);
  fireEvent.click(screen.getByTestId(`velero-schedule-${command}`));
  await screen.findByTestId(`velero-schedule-${command}-workspace`);
}

async function review(main: ReturnType<typeof mainProcess>, text: string) {
  press("ask");
  await waitFor(() => expect(main.confirms.length).toBeGreaterThan(0));
  await main.confirm(text);
  await waitFor(() => expect(maybe("review")).toBeTruthy());
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  held.weeklyPaused = false;
});

afterEach(() => {
  act(() => closeViews());
  cleanup();
  confirmDialogs.length = 0;
  vi.useRealTimers();
});

describe("pause and resume, from the view of a schedule", () => {
  it("offers Pause on a schedule that is not paused and Resume on one that is, never both, each over the view, named in the address", async () => {
    const { main } = mount();

    await openSchedule("weekly");
    expect(screen.queryByTestId("velero-schedule-resume")).toBeNull();
    expect(words(screen.getByTestId("velero-schedule-pause"))).toBe("Pause");
    fireEvent.click(screen.getByTestId("velero-schedule-pause"));
    await screen.findByTestId("velero-schedule-pause-workspace");
    expect(openViews()).toEqual([
      { kind: "schedule", name: "weekly" },
      { kind: "schedule-pause", name: "weekly" },
    ]);
    expect(screen.getByTestId("velero-schedule-pause-name").textContent).toBe("Pause schedule");
    expect(words(part("what"))).toBe(SCHEDULE_PATCH_VIEW_WORDS.what("schedule-pause", "weekly", A));
    // A pause offers no choice, and writes nothing by itself.
    expect(maybe("choice")).toBeNull();
    expect(words(part("writes-off"))).toBe(SCHEDULE_PATCH_VIEW_WORDS.writesOff("schedule-pause"));
    fireEvent.click(screen.getByTestId("velero-back"));
    await screen.findByTestId("velero-schedule-workspace");
    expect(openViews()).toEqual([{ kind: "schedule", name: "weekly" }]);
    fireEvent.click(screen.getByTestId("velero-back"));
    await openSchedule("nightly");
    expect(screen.queryByTestId("velero-schedule-pause")).toBeNull();
    expect(words(screen.getByTestId("velero-schedule-resume"))).toBe("Resume");
    fireEvent.click(screen.getByTestId("velero-schedule-resume"));
    await screen.findByTestId("velero-schedule-resume-workspace");
    expect(openViews()).toEqual([
      { kind: "schedule", name: "nightly" },
      { kind: "schedule-resume", name: "nightly" },
    ]);
    expect(main.confirms).toHaveLength(0);
  });

  it("fills the form with writes off, proposes skip immediately as the schedule carries it, and leads to the target bar", async () => {
    const { main } = mount();

    await action("nightly", "resume");
    const skip = part("skip") as HTMLInputElement;

    expect(skip.checked).toBe(true);
    expect(part("carried").textContent).toBe(SCHEDULE_PATCH_VIEW_WORDS.carried(true, true));
    expect(skip.getAttribute("aria-describedby")).toBe("velero-schedule-patch-skip-note velero-schedule-patch-carried");
    fireEvent.click(skip);
    expect(skip.checked).toBe(false);
    expect(part("carried").textContent).toBe(SCHEDULE_PATCH_VIEW_WORDS.carried(true, false));
    expect(words(part("writes-off"))).toBe(SCHEDULE_PATCH_VIEW_WORDS.writesOff("schedule-resume"));
    expect(maybe("ask")).toBeNull();
    fireEvent.click(part("to-target"));
    expect(focused()).toBe("velero-writes-on");
    expect(main.confirms).toHaveLength(0);
    // A schedule that carries no skip immediately is proposed false, with the words of the setting of the server.
    fireEvent.click(screen.getByTestId("velero-back"));
    fireEvent.click(screen.getByTestId("velero-back"));
    await action("bare", "resume");
    expect((part("skip") as HTMLInputElement).checked).toBe(false);
    expect(part("carried").textContent).toBe(SCHEDULE_PATCH_VIEW_WORDS.carried(undefined, false));
  });

  it("pauses: the text of the main process as it came beside what it means, then the schedule read after the patch, and the way to its view", async () => {
    const { main, installation } = mount();

    await action("weekly", "pause");
    await writesOn();
    press("ask");
    // While the main process is asked, the words that say so have the focus.
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    expect(focused()).toBe("velero-schedule-patch-status");
    expect(words(part("status"))).toBe(SCHEDULE_PATCH_VIEW_WORDS.asking);
    await main.confirm(PAUSE);
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    expect(main.confirms[0].args).toEqual([
      "cluster-a",
      A,
      "schedule-pause",
      { name: "weekly", uid: "weekly-uid" },
      undefined,
    ]);
    expect(focused()).toBe("velero-schedule-patch-review");
    expect(part("text").textContent).toBe(PAUSE);
    expect([...part("meaning").querySelectorAll("[data-part]")].map((item) => item.getAttribute("data-part"))).toEqual([
      "reads",
      "running",
      "adherence",
      "only",
    ]);
    expect(words(part("review"))).toContain(SCHEDULE_PATCH_VIEW_WORDS.review("schedule-pause"));
    expect(words(part("review"))).toContain("local-demo (context kind-local-demo)");
    expect(words(part("review"))).toContain(`Namespace${A}`);
    expect(words(part("run"))).toBe("Pause the schedule");
    press("run");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    expect(main.runs[0].args).toEqual([
      "cluster-a",
      A,
      "schedule-pause",
      { name: "weekly", uid: "weekly-uid" },
      "token-1",
      expect.any(String),
    ]);
    expect(words(part("status"))).toBe(SCHEDULE_PATCH_VIEW_WORDS.running("schedule-pause", "weekly"));
    await main.run({ ok: true, value: { name: "weekly", uid: "weekly-uid", paused: true } });
    await waitFor(() => expect(maybe("result")).toBeTruthy());
    expect(focused()).toBe("velero-schedule-patch-result");
    expect(words(part("result-0"))).toBe(SCHEDULE_PATCH_VIEW_WORDS.paused("weekly"));
    expect(maybe("found")).toBeNull();
    // The end shown is told to the main process, which keeps it no more.
    await waitFor(() => expect(main.shown).toEqual([main.runs[0].args[5]]));
    // The views read the schedule paused since: the result stays, and is not taken for a pause asked again.
    held.weeklyPaused = true;
    await act(() => installation.refresh());
    expect(maybe("result")).toBeTruthy();
    expect(maybe("refused")).toBeNull();
    fireEvent.click(part("open"));
    await screen.findByTestId("velero-schedule-workspace");
    expect(openViews()).toEqual([{ kind: "schedule", name: "weekly" }]);
  });

  it("resumes with the choice made: the meaning of the resume, the patch of that choice, and what skip immediately holds after it", async () => {
    const { main } = mount();

    await action("nightly", "resume");
    await writesOn();
    fireEvent.click(part("skip"));
    await review(main, resumeText(false));
    expect(main.confirms[0].args).toEqual([
      "cluster-a",
      A,
      "schedule-resume",
      { name: "nightly", uid: "nightly-uid" },
      { expression: EXPRESSION, skipImmediately: false },
    ]);
    expect([...part("meaning").querySelectorAll("[data-part]")].map((item) => item.getAttribute("data-part"))).toEqual([
      "due",
      "runs",
      "validation",
      "skip",
      "only",
    ]);
    expect(part("meaning").querySelector('[data-part="due"]')?.textContent).toContain(
      "Velero would submit a backup at once",
    );
    // The review takes the place of the form: the choice is made again only once it is left.
    expect(maybe("skip")).toBeNull();
    press("run");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    await main.run({
      ok: true,
      value: { name: "nightly", uid: "nightly-uid", paused: false, skipImmediately: false, found: true },
    });
    await waitFor(() => expect(maybe("result")).toBeTruthy());
    expect([words(part("result-0")), words(part("result-1")), words(part("found"))]).toEqual([
      SCHEDULE_PATCH_VIEW_WORDS.resumed("nightly"),
      "Skip immediately is false: a run that is due is submitted.",
      SCHEDULE_PATCH_VIEW_WORDS.found,
    ]);
  });

  it("leaves a review by its command or Escape, and asks a new one for another choice", async () => {
    const { main } = mount();

    await action("nightly", "resume");
    await writesOn();
    await review(main, resumeText(true));
    fireEvent.keyDown(part("review"), { key: "Escape" });
    await waitFor(() => expect(maybe("review")).toBeNull());
    // Escape left the review and not the view.
    expect(screen.getByTestId("velero-schedule-resume-workspace")).toBeTruthy();
    expect(focused()).toBe("velero-schedule-patch-ask");
    await review(main, resumeText(true));
    press("back");
    await waitFor(() => expect(maybe("review")).toBeNull());
    fireEvent.click(part("skip"));
    await review(main, resumeText(false));
    expect(main.confirms.map((held) => (held.args[4] as { skipImmediately: boolean }).skipImmediately)).toEqual([
      true,
      true,
      false,
    ]);
    expect(main.runs).toHaveLength(0);
  });

  it("says a review the main process refused or answered with another patch, and a patch whose answer is not known", async () => {
    const { main } = mount();

    await action("weekly", "pause");
    await writesOn();
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    // Another patch than the one asked is no review.
    await main.confirm(resumeText(true));
    await waitFor(() => expect(maybe("failure")).toBeTruthy());
    expect(part("failure").getAttribute("data-stage")).toBe("review");
    await review(main, PAUSE);
    press("run");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    const lost: Failure = {
      ok: false,
      code: "submission-unknown",
      stage: "patch",
      retry: false,
      text: "The API server did not answer the pause, and the schedule weekly is not paused as far as the read shows.",
    };

    await main.run(lost);
    await waitFor(() => expect(maybe("failure")).toBeTruthy());
    expect([part("failure").getAttribute("data-code"), part("failure").getAttribute("data-left")]).toEqual([
      "submission-unknown",
      "unknown",
    ]);
    expect(words(part("failure-text"))).toBe(lost.text);
    expect(words(part("failure-left"))).toBe(SCHEDULE_PATCH_VIEW_WORDS.unknownLeft);
    // The workspace said the end in the words of the main process, which keeps it no more.
    await waitFor(() => expect(main.shown).toEqual([main.runs[0].args[5]]));
  });

  it("opens the form the address names with the choice the schedule carries, and leaves its review when it closes or writes go off", async () => {
    const { main } = mount();

    await waitFor(() => expect(screen.getByText("nightly", { selector: "[data-schedule-row]" })).toBeTruthy());
    act(() => openView({ kind: "schedule-resume", name: "nightly" }));
    await screen.findByTestId("velero-schedule-resume-workspace");
    expect((part("skip") as HTMLInputElement).checked).toBe(true);
    await writesOn();
    await review(main, resumeText(true));
    // The workspace that closes leaves the review: opened again, it asks for a new one.
    fireEvent.click(screen.getByTestId("velero-back"));
    await waitFor(() => expect(screen.queryByTestId("velero-schedule-resume-workspace")).toBeNull());
    act(() => openView({ kind: "schedule-resume", name: "nightly" }));
    await screen.findByTestId("velero-schedule-resume-workspace");
    expect(maybe("review")).toBeNull();
    expect(maybe("ask")).toBeTruthy();
    // Writes that go off leave the review as well.
    await review(main, resumeText(true));
    fireEvent.click(screen.getByTestId("velero-writes-off"));
    await waitFor(() => expect(maybe("review")).toBeNull());
    expect(words(part("writes-off"))).toBe(SCHEDULE_PATCH_VIEW_WORDS.writesOff("schedule-resume"));
    expect(main.runs).toHaveLength(0);
  });

  it("takes the words of a failure away when the choice changes, since the form is what is shown again", async () => {
    const { main } = mount();

    await action("nightly", "resume");
    await writesOn();
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    await main.confirm(PAUSE);
    await waitFor(() => expect(maybe("failure")).toBeTruthy());
    fireEvent.click(part("skip"));
    expect(maybe("failure")).toBeNull();
    expect((part("skip") as HTMLInputElement).checked).toBe(false);
  });

  it("keeps the words of a failed run in sight when the schedule was read since as the action is not for, and tells it shown", async () => {
    const { main, installation } = mount();

    await action("weekly", "pause");
    await writesOn();
    await review(main, PAUSE);
    press("run");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    // The patch was applied, and its answer lost: the views read the schedule paused meanwhile.
    held.weeklyPaused = true;
    await act(() => installation.refresh());
    // A patch being sent is said as such, whatever the read says.
    expect(words(part("status"))).toBe(SCHEDULE_PATCH_VIEW_WORDS.running("schedule-pause", "weekly"));
    expect(maybe("refused")).toBeNull();
    const lost: Failure = {
      ok: false,
      code: "submission-unknown",
      stage: "patch",
      retry: false,
      text: "The API server did not answer the patch, and the schedule weekly could not be read.",
    };

    await main.run(lost);
    await waitFor(() => expect(maybe("failure")).toBeTruthy());
    expect([words(part("failure-text")), words(part("refused"))]).toEqual([
      lost.text,
      SCHEDULE_PATCH_VIEW_WORDS.notNow("schedule-pause", "weekly"),
    ]);
    // No command follows: the failure has the focus, and the end the workspace showed is told.
    expect(maybe("ask")).toBeNull();
    expect(focused()).toBe("velero-schedule-patch-failure");
    await waitFor(() => expect(main.shown).toEqual([main.runs[0].args[5]]));
  });

  it("says a patch of another schedule being sent, and a resume of a schedule that is not paused, by the address", async () => {
    const { main } = mount();

    await action("weekly", "pause");
    await writesOn();
    await review(main, PAUSE);
    press("run");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    act(() => openView({ kind: "schedule-resume", name: "nightly" }));
    await screen.findByTestId("velero-schedule-resume-workspace");
    expect(words(part("another"))).toBe(SCHEDULE_PATCH_VIEW_WORDS.another("weekly"));
    await main.run({ ok: true, value: { name: "weekly", uid: "weekly-uid", paused: true } });
    // Once it ended, the form of this schedule is given.
    await waitFor(() => expect(maybe("skip")).toBeTruthy());
    act(() => openView({ kind: "schedule-resume", name: "weekly" }));
    await screen.findByTestId("velero-schedule-resume-workspace");
    expect(words(part("refused"))).toBe(SCHEDULE_PATCH_VIEW_WORDS.notNow("schedule-resume", "weekly"));
    expect(maybe("ask")).toBeNull();
  });

  it("drops everything of the pause and of the resume when another installation is selected, and when the extension goes", async () => {
    const { main, installation } = mount();

    await action("weekly", "pause");
    await writesOn();
    await review(main, PAUSE);
    act(() => {
      installation.configure("velero-b");
    });
    await waitFor(() => expect(installation.pauseResume.schedule).toBeUndefined());
    expect(installation.pauseResume.step).toEqual({ state: "form" });
    act(() => installation.pauseResume.start("schedule-pause", { name: "weekly", uid: "weekly-uid" }, undefined));
    act(() => installation.dispose());
    expect(installation.pauseResume.schedule).toBeUndefined();
  });

  it("says why an action is not offered by the address: a schedule paused already, or one with no expression to test", async () => {
    mount();
    await openSchedule("nightly");
    fireEvent.click(screen.getByTestId("velero-back"));
    act(() => {
      closeViews();
    });
    await waitFor(() => expect(screen.getByText("nightly", { selector: "[data-schedule-row]" })).toBeTruthy());
    // The address names the pause of a schedule that is paused.
    act(() => openView({ kind: "schedule-pause", name: "nightly" }));
    await screen.findByTestId("velero-schedule-pause-workspace");
    expect(words(part("refused"))).toBe(SCHEDULE_PATCH_VIEW_WORDS.notNow("schedule-pause", "nightly"));
    expect(maybe("ask")).toBeNull();
    fireEvent.click(screen.getByTestId("velero-back"));
    // The view of a schedule that reports no expression offers Resume disabled, with the words why; the address opens
    // its workspace all the same, which says it.
    await openSchedule("blank");
    const resume = screen.getByTestId("velero-schedule-resume") as HTMLButtonElement;

    expect(resume.disabled).toBe(true);
    expect(document.getElementById(resume.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      SCHEDULE_PATCH_VIEW_WORDS.noExpression("blank"),
    );
    act(() => openView({ kind: "schedule-resume", name: "blank" }));
    await screen.findByTestId("velero-schedule-resume-workspace");
    expect(words(part("refused"))).toBe(SCHEDULE_PATCH_VIEW_WORDS.noExpression("blank"));
    expect(maybe("ask")).toBeNull();
  });
});
