// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleObject, submissionOf } from "../../../test/adherence-builders";
import { hostObject } from "../../../test/freelens-extensions";
import { drawerValue, listProps } from "../../../test/host-components";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { formatDuration } from "../../common/duration";
import { adherenceContext, agoText, clocksOf, SIGNAL_WORDS, scheduleSignal } from "../../common/schedule-signal";
import { NOTES } from "../../common/schedule-view";
import { Schedule } from "../api/kinds";
import { adherenceTip, BAND_WORDS } from "../components/adherence";
import { ScheduleDetails } from "../details/schedule-details";
import { closeViews, openView, openViews } from "../navigation";
import { adherenceOf, unreadAdherence } from "../state/adherence";
import { Installation } from "../state/installation";
import { BackupsPage } from "./backups-page";
import { SchedulesPage } from "./schedules-page";

import type { Renderer } from "@freelensapp/extensions";

import type { Answer, Family, Preferences } from "../../common/discovery";
import type { ScheduleResource } from "../../common/types";

// The zone of the machine the tests run on is one no case below is computed or written in, fourteen hours east
// of UTC, as in the tests of the signal: a word of the adherence written in it would fail.
process.env.TZ = "Pacific/Kiritimati";

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";
const A = "velero-a";
const B = "velero-b";
const NOW = Date.parse("2026-09-10T12:00:00Z");

type Answers = Record<string, Answer | (() => Promise<Answer>)>;

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

function object(
  kind: string,
  name: string,
  namespace: string,
  spec?: object,
  status?: object,
  more: { labels?: Record<string, string>; created?: string } = {},
) {
  return {
    apiVersion: "velero.io/v1",
    kind,
    metadata: {
      name,
      namespace,
      uid: `${namespace}-${kind.toLowerCase()}-${name}`,
      resourceVersion: "1",
      creationTimestamp: more.created ?? "2026-08-01T00:00:00Z",
      ...(more.labels ? { labels: more.labels } : {}),
    },
    ...(spec ? { spec } : {}),
    ...(status ? { status } : {}),
  };
}

const template = { includedNamespaces: ["shop"], storageLocation: "default", ttl: "720h0m0s" };
const nightly = object(
  "Schedule",
  "nightly",
  A,
  // The release writes whether it skips into every schedule it reads.
  {
    schedule: "TZ=Europe/Rome 0 3 * * *",
    skipImmediately: false,
    template: { ...template, volumeSnapshotLocations: ["snapshots"] },
  },
  { phase: "Enabled", lastBackup: "2026-09-10T01:00:00Z" },
);
const paused = object(
  "Schedule",
  "weekly",
  A,
  {
    schedule: "0 4 * * 0",
    paused: true,
    skipImmediately: false,
    template: { ...template, storageLocation: "archive" },
  },
  { phase: "Enabled", lastBackup: "2026-08-30T04:00:00Z", lastSkipped: "2026-09-02T09:00:00Z" },
);
const invalid = object(
  "Schedule",
  "broken",
  A,
  { schedule: "every night", skipImmediately: false, template: { ...template, storageLocation: "removed" } },
  { phase: "FailedValidation", validationErrors: ["invalid schedule: expected exactly 5 fields, found 2"] },
);
const unread = object("Schedule", "fresh", A, { schedule: "@daily", skipImmediately: true, template: {} });
const of = (schedule: string) => ({ labels: { "velero.io/schedule-name": schedule } });
const ran = (date: string, phase = "Completed", errors = 0) => ({
  phase,
  startTimestamp: `${date}T01:00:00Z`,
  ...(phase === "InProgress" ? {} : { completionTimestamp: `${date}T01:04:00Z` }),
  // The release writes no counter of zero.
  ...(errors ? { errors } : {}),
});
const backups = [
  object("Backup", "nightly-20260907", A, template, ran("2026-09-07"), of("nightly")),
  object("Backup", "nightly-20260908", A, template, ran("2026-09-08", "PartiallyFailed", 2), of("nightly")),
  object("Backup", "nightly-20260909", A, template, ran("2026-09-09"), of("nightly")),
  // The newest: it failed its validation, and has no start time.
  object(
    "Backup",
    "nightly-20260910",
    A,
    template,
    { phase: "FailedValidation", validationErrors: ["the location is unavailable"] },
    { ...of("nightly"), created: "2026-09-10T01:00:00Z" },
  ),
  object("Backup", "weekly-20260830", A, template, ran("2026-08-30"), of("weekly")),
  object("Backup", "by-hand", A, template, ran("2026-09-09")),
];
const served: Answer = { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } };

function answers(more: Answers = {}): Answers {
  return {
    [DISCOVERY]: served,
    [LOCATIONS]: list({ metadata: { name: "default", namespace: A } }, { metadata: { name: "default", namespace: B } }),
    [path("schedules", A)]: list(nightly, paused, invalid, unread),
    [path("schedules", B)]: list(object("Schedule", "nightly", B, { schedule: "0 1 * * *" }, { phase: "Enabled" })),
    [path("backups", A)]: list(...backups),
    [path("backups", B)]: list(),
    [path("restores", A)]: list(
      object("Restore", "restore-from-nightly", A, { scheduleName: "nightly" }, { phase: "Completed" }),
      object("Restore", "restore-of-a-backup", A, { backupName: "nightly-20260909", scheduleName: "nightly" }),
      object("Restore", "restore-of-weekly", A, { scheduleName: "weekly" }),
    ),
    [path("restores", B)]: list(),
    [path("storageLocations", A)]: list(
      object("BackupStorageLocation", "default", A, { default: true, accessMode: "ReadWrite" }, { phase: "Available" }),
      object("BackupStorageLocation", "archive", A, { accessMode: "ReadOnly" }, { phase: "Available" }),
    ),
    [path("storageLocations", B)]: list(),
    [path("snapshotLocations", A)]: list(object("VolumeSnapshotLocation", "snapshots", A, { provider: "aws" })),
    [path("snapshotLocations", B)]: list(),
    ...more,
  };
}

// The four schedules of the fixtures and, beside them, one of each state they lack: one overdue by an hour, one
// due by two minutes, one whose run of an hour ago a backup in progress holds, and one whose expression has no
// instant, which Velero submits at every look.
function eachState() {
  const enabled = (name: string, expression: string, lastBackup: string) =>
    object(
      "Schedule",
      name,
      A,
      { schedule: expression, skipImmediately: false, template },
      { phase: "Enabled", lastBackup },
    );
  const all = [
    nightly,
    paused,
    invalid,
    unread,
    enabled("late", "TZ=UTC 0 11 * * *", "2026-09-09T11:00:00Z"),
    enabled("tick", "TZ=UTC 58 11 * * *", "2026-09-09T11:58:00Z"),
    enabled("holding", "TZ=UTC 0 11 * * *", "2026-09-09T11:00:00Z"),
    enabled("look", "TZ=UTC 0 0 30 2 *", "2026-09-10T11:59:00Z"),
  ];
  const inProgress = object(
    "Backup",
    "holding-20260909110000",
    A,
    template,
    { phase: "InProgress", startTimestamp: "2026-09-09T11:00:02Z" },
    { ...of("holding"), created: "2026-09-09T11:00:01Z" },
  );

  return {
    all,
    table: answers({ [path("schedules", A)]: list(...all), [path("backups", A)]: list(...backups, inProgress) }),
  };
}

function mount(table: Answers, preferences: Preferences = emptyPreferences(), page = SchedulesPage) {
  const asked: string[] = [];
  const clock = { now: NOW };
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => {
      asked.push(address);
      const answer = table[address] ?? { status: 404 };

      return typeof answer === "function" ? answer() : answer;
    },
    now: () => clock.now,
    storage: heldPreferences(preferences),
  });
  const Page = page;
  const view = render(<Page installation={installation} />);

  return { installation, asked, clock, table, view };
}

const chosen = (namespace: string): Preferences => ({ selected: { "cluster-a": namespace }, configured: {} });
const rows = (kind = "schedule") =>
  [...document.querySelectorAll(`[data-${kind}-row]`)].map((row) => row.getAttribute(`data-${kind}-row`));
const row = (name: string) =>
  screen.getByText(name, { selector: "[data-schedule-row]" }).closest(".TableRow") as HTMLElement;
const cell = (name: string, column: string) => row(name).querySelector(`.TableCell.${column}`)?.textContent;
const notice = (family: string) => screen.queryByTestId(`velero-notice-${family}`)?.textContent ?? "";
const open = async (name: string) => {
  await waitFor(() => expect(rows()).toContain(name));
  fireEvent.click(screen.getByText(name, { selector: "[data-schedule-row]" }));
  return screen.findByTestId("velero-schedule-workspace");
};
const history = () =>
  [...document.querySelectorAll("[data-history-row]")].map((item) => item.getAttribute("data-history-row"));
const marks = () =>
  [...document.querySelectorAll("[data-strip-mark]")].map((mark) => mark.getAttribute("data-strip-mark"));

// The page takes the time from the clock of the machine: every test gives it the one the fixtures are
// written for. A line of time drawn at the time the tests are run would change with the day they are run.
beforeEach(() => {
  vi.setSystemTime(NOW);
});

afterEach(() => {
  act(() => closeViews());
  cleanup();
  listProps.clear();
  vi.useRealTimers();
});

describe("list of the schedules", () => {
  it("gives the host a list that only reads, with the columns of the schedules", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toEqual(["nightly", "weekly", "broken", "fresh"]));
    const props = listProps.get("veleroSchedulesTable") ?? {};
    const columns = props.renderTableHeader as { id: string; sortBy: string; className: string }[];

    expect(props.isSelectable).toBe(false);
    expect((props.renderItemMenu as () => unknown)()).toBeNull();
    expect(props.subscribeStores).toBe(false);
    for (const forbidden of ["onAdd", "addRemoveButtons", "renderFooter", "headerActions"]) {
      expect(props[forbidden]).toBeUndefined();
    }
    expect(columns.map((column) => column.id)).toEqual([
      "name",
      "namespace",
      "schedule",
      "paused",
      "next",
      "adherence",
      "submitted",
      "newest",
      "validation",
      "age",
    ]);
    expect(columns.map((column) => column.className)).toEqual([
      "name",
      "installation",
      "schedule",
      "paused",
      "next",
      "adherence",
      "submitted",
      "newest",
      "phase",
      "age",
    ]);
    expect(Object.keys(props.sortingCallbacks as object).sort()).toEqual(columns.map((column) => column.sortBy).sort());
    expect(screen.queryByTestId("velero-coverage")).toBeNull();
  });

  // The order by the next run, as the host sorts by the callbacks of a column when its head is
  // clicked, and in the other way at the second click.
  it("orders by the next run as the host sorts by its callback: the instants, then Not known, then None", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(4));
    const props = listProps.get("veleroSchedulesTable") ?? {};
    const items = (props.getItems as () => unknown[])();
    const callbacks = props.sortingCallbacks as Record<string, (item: unknown) => unknown>;

    // No callback gives the host what it cannot compare.
    for (const item of items) {
      for (const column of ["next", "adherence"]) {
        for (const value of [callbacks[column](item)].flat()) {
          expect(value).not.toBeUndefined();
          expect(Number.isNaN(value)).toBe(false);
        }
      }
    }
    const head = (column: string) => document.querySelector(`.TableHead .TableCell.${column}`) as HTMLElement;

    fireEvent.click(head("next"));
    expect(rows()).toEqual(["nightly", "fresh", "broken", "weekly"]);
    fireEvent.click(head("next"));
    expect(rows()).toEqual(["weekly", "broken", "fresh", "nightly"]);
  });

  it("orders the runs of each state from the earliest, two of one instant by name, then Not known, then None", async () => {
    const { all, table } = eachState();

    mount(table, chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(all.length));
    const head = document.querySelector(".TableHead .TableCell.next") as HTMLElement;
    // holding and late were both expected at 11:00 and tick at 11:58, nightly runs tomorrow at three in Rome; fresh
    // is not known; broken, look and weekly have none.
    const order = ["holding", "late", "tick", "nightly", "fresh", "broken", "look", "weekly"];

    fireEvent.click(head);
    expect(rows()).toEqual(order);
    fireEvent.click(head);
    expect(rows()).toEqual([...order].reverse());
  });

  it("orders by adherence: the weight of the state, then the expected run, then the name, and back", async () => {
    const enabled = (name: string, expression: string, lastBackup: string) =>
      object(
        "Schedule",
        name,
        A,
        { schedule: expression, skipImmediately: false, template },
        { phase: "Enabled", lastBackup },
      );
    // Overdue by an hour, due by two minutes, and two awaited at the same instant, whose names decide.
    const more = [
      enabled("late", "TZ=UTC 0 11 * * *", "2026-09-09T11:00:00Z"),
      enabled("tick", "TZ=UTC 58 11 * * *", "2026-09-09T11:58:00Z"),
      enabled("soon-b", "TZ=UTC 0 13 * * *", "2026-09-09T13:00:00Z"),
      enabled("soon-a", "TZ=UTC 0 13 * * *", "2026-09-09T13:00:00Z"),
    ];
    const all = [nightly, paused, invalid, unread, ...more];
    const { installation } = mount(answers({ [path("schedules", A)]: list(...all) }), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(all.length));
    const context = adherenceOf(installation, NOW);
    const signals = Object.fromEntries(
      all.map((resource) => [resource.metadata.name, scheduleSignal(resource as unknown as ScheduleResource, context)]),
    );
    const key = (name: string): [number, number, string] => [signals[name].weight, signals[name].measure ?? 0, name];
    const before = (one: [number, number, string], other: [number, number, string]) =>
      one[0] < other[0] || (one[0] === other[0] && (one[1] < other[1] || (one[1] === other[1] && one[2] < other[2])));
    const head = document.querySelector(".TableHead .TableCell.adherence") as HTMLElement;

    fireEvent.click(head);
    const ordered = rows() as string[];

    for (let index = 1; index < ordered.length; index++) {
      expect([ordered[index - 1], ordered[index], before(key(ordered[index - 1]), key(ordered[index]))]).toEqual([
        ordered[index - 1],
        ordered[index],
        true,
      ]);
    }
    // What the fixtures give the order to decide: six weights, two of one weight by their expected run, and two of
    // one weight and one expected run by their names.
    expect(new Set(all.map((resource) => signals[resource.metadata.name].weight)).size).toBe(6);
    expect(signals["soon-a"].weight).toBe(signals.nightly.weight);
    expect(signals["soon-a"].measure).not.toBe(signals.nightly.measure);
    expect(key("soon-a").slice(0, 2)).toEqual(key("soon-b").slice(0, 2));
    fireEvent.click(head);
    expect(rows()).toEqual([...ordered].reverse());
  });

  it("is searched by what every column shows but the age, which the host writes", async () => {
    const { installation } = mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(4));
    const props = listProps.get("veleroSchedulesTable") ?? {};
    const items = (props.getItems as () => { getName(): string }[])();
    const nightly = items.find((item) => item.getName() === "nightly");
    const searched = (props.searchFilters as ((item: unknown) => string[])[]).flatMap((filter) => filter(nightly));

    // One text for each column, as the cell of the column shows it without its mark.
    for (const column of ["installation", "schedule", "paused", "submitted"]) {
      expect(cell("nightly", column)).not.toBe("");
      expect([column, searched]).toEqual([column, expect.arrayContaining([cell("nightly", column)])]);
    }
    expect(searched).toContain("nightly");
    expect(searched).toContain("Enabled");
    // Of the adherence: the word of the state, the text of the next run and the notes, and not the sentence.
    const signal = scheduleSignal(nightly as unknown as ScheduleResource, adherenceOf(installation, NOW));

    expect(searched).toEqual(expect.arrayContaining([signal.label, signal.next.text, ...signal.notes]));
    expect(searched).not.toContain(signal.words);
    // The newest backup by its name and by how it ended.
    const newest = cell("nightly", "newest") ?? "";

    expect(newest).toContain("nightly-20260910");
    expect(newest).toContain("1 validation error");
    expect(searched).toContain("nightly-20260910");
    expect(searched).toContain("1 validation error");
    expect(searched).not.toContain("");
  });

  it("keeps paused and validation as two facts, and the expression as it is written", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect([cell("weekly", "paused"), cell("weekly", "phase")]).toEqual(["Paused", "check_circle_outlineEnabled"]);
    expect([cell("nightly", "paused"), cell("nightly", "phase")]).toEqual([
      "Not paused",
      "check_circle_outlineEnabled",
    ]);
    expect([cell("broken", "paused"), cell("broken", "phase")]).toEqual([
      "Not paused",
      "highlight_offFailed validation",
    ]);
    // A schedule Velero has not read has no validation: it is not shown as enabled.
    expect(cell("fresh", "phase")).toBe("help_outlineNot reported");
    expect(row("fresh").querySelector("[data-validation]")?.getAttribute("data-validation")).toBe("not-validated");
    expect(cell("nightly", "schedule")).toBe("TZ=Europe/Rome 0 3 * * *");
    expect(cell("broken", "schedule")).toBe("every night");
  });

  it("shows the last submission and the newest backup as two values, and the second says how it ended", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(4));
    const newest = row("nightly").querySelector(".TableCell.newest");

    // The newest backup of the schedule is the one that failed its validation, which never started.
    expect(newest?.textContent).toContain("nightly-20260910");
    expect(newest?.textContent).toContain("1 validation error");
    expect(newest?.querySelector("[data-signal]")?.getAttribute("data-signal")).toBe("failure");
    expect(cell("nightly", "submitted")).toBe(new Date("2026-09-10T01:00:00Z").toLocaleString());
    expect(cell("weekly", "newest")).toContain("weekly-20260830");
    expect(row("weekly").querySelector(".TableCell.newest [data-signal]")?.getAttribute("data-signal")).toBe("none");
    expect(cell("broken", "newest")).toBe("None that exists");
    expect(cell("broken", "submitted")).toBe("Not reported");
  });

  it("does not say that a schedule has no backup when the backups cannot be read", async () => {
    const { installation } = mount(answers({ [path("backups", A)]: { status: 403 } }), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(4));
    // A refusal is an answer: the next run and the adherence are said, and what needs the backups says why it is
    // not known, where a read that never ended says nothing.
    const said = (resource: object) =>
      scheduleSignal(resource as unknown as ScheduleResource, adherenceOf(installation, NOW));
    const fixtures: [string, object][] = [
      ["nightly", nightly],
      ["weekly", paused],
      ["broken", invalid],
      ["fresh", unread],
    ];

    for (const [name, resource] of fixtures) {
      expect([
        name,
        cell(name, "next"),
        row(name).querySelector("[data-adherence]")?.getAttribute("data-adherence"),
      ]).toEqual([name, said(resource).next.text, said(resource).state]);
    }
    const ofNightly = said(nightly);
    const hold = ofNightly.hold?.state === "not-known" ? SIGNAL_WORDS.holdNotKnown(ofNightly.hold.reason) : "";

    expect(ofNightly.notes).toContain(hold);
    const pointed = row("nightly").querySelector(".TableCell.adherence [id^='tooltip_target_']") as HTMLElement;

    fireEvent.mouseEnter(pointed);
    expect(screen.getByRole("tooltip").textContent).toContain(hold);
    fireEvent.mouseLeave(pointed);
    for (const name of ["nightly", "weekly", "broken"]) {
      expect(cell(name, "newest")).toBe("Not known");
      expect(row(name).querySelector("[data-newest]")?.getAttribute("data-newest")).toBe("unknown");
    }
    expect(document.body.textContent).not.toContain("None that exists");
    // The rows say it: the notice of what is denied is of the view of a schedule, which shows its history.
    expect(screen.queryByTestId("velero-notice-backups")).toBeNull();
    expect(screen.queryByTestId("velero-notice-schedules")).toBeNull();
    const workspace = await open("nightly");

    expect(within(workspace).getByTestId("velero-schedule-history").getAttribute("data-history")).toBe("inaccessible");
    expect(notice("backups")).toContain("denied");
    // The band draws its lines, and the line of the hold says why it is not known.
    const band = within(workspace).getByTestId("velero-schedule-adherence");

    expect(band.getAttribute("data-adherence")).toBe(ofNightly.state);
    expect(band.querySelector('[data-line="held"] td')?.textContent).toBe(hold);
  });

  // SCHED-03 as SPEC-0013 restates it: what the list computes from an expression is the next run and the
  // adherence the signal gives for the reads of the installation and the clock, in their two columns, and
  // nothing else of the list is.
  it("shows no time that no object reports but the next run and the adherence the signal computes", async () => {
    const { installation } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(4));
    const context = adherenceOf(installation, NOW);
    const kinds: Record<string, string> = {};

    for (const resource of [nightly, paused, invalid, unread]) {
      const signal = scheduleSignal(resource as unknown as ScheduleResource, context);

      kinds[resource.metadata.name] = signal.next.kind;
      expect(signal.next.text).toMatch(/\S/);
      expect(cell(resource.metadata.name, "next")).toBe(signal.next.text);
      expect(cell(resource.metadata.name, "adherence")).toContain(signal.label);
    }
    // The expression that names its zone has an instant; the paused and the refused ones have none, and the one
    // Velero never read says why its run is not known.
    expect(kinds).toEqual({ nightly: "at", weekly: "none", broken: "none", fresh: "not-known" });
    const outside = screen.getByTestId("velero-schedules").cloneNode(true) as HTMLElement;

    for (const computed of outside.querySelectorAll(".TableCell.next, .TableCell.adherence")) computed.remove();
    expect(outside.textContent).not.toMatch(/next|overdue|missed|expected|late\b/i);
  });

  // On the four schedules of the fixtures: the cells say what the signal says, and their tips are the ones
  // the host shows to who points at them: the instant of a run as the host writes a date, the reason of a run that
  // is None or Not known, the sentence and the notes of the adherence.
  it("says in the cells and their tips what the signal says of a schedule of each state", async () => {
    const { all, table } = eachState();
    const { installation } = mount(table, chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(all.length));
    const context = adherenceOf(installation, NOW);
    const tipOf = (target: Element | null | undefined) => {
      const pointed = target?.querySelector("[id^='tooltip_target_']") as HTMLElement;

      fireEvent.mouseEnter(pointed);
      const tip = screen.getByRole("tooltip").textContent;

      fireEvent.mouseLeave(pointed);
      expect(screen.queryByRole("tooltip")).toBeNull();
      return tip;
    };

    const states = new Set<string>();

    for (const resource of all) {
      const name = resource.metadata.name;
      const signal = scheduleSignal(resource as unknown as ScheduleResource, context);
      const next = row(name).querySelector(".TableCell.next");

      states.add(signal.state);
      const adherence = row(name).querySelector(".TableCell.adherence");

      expect(next?.querySelector("[data-next]")?.getAttribute("data-next")).toBe(signal.next.kind);
      expect(tipOf(next)).toBe(
        signal.next.kind === "at" ? `${new Date(signal.next.at).toISOString().slice(0, 19)}Z` : signal.next.why,
      );
      const mark = adherence?.querySelector("[data-adherence]");

      expect(mark?.getAttribute("data-adherence")).toBe(signal.state);
      expect(mark?.getAttribute("data-mark")).toBe(signal.mark);
      expect(mark?.textContent).toContain(signal.label);
      expect(tipOf(adherence)).toBe(adherenceTip(signal));
    }
    expect([...states].sort()).toEqual(
      ["at-every-look", "awaited", "due", "held", "not-known", "overdue", "paused", "refused"].sort(),
    );
  });

  // The cells of the adherence are there and say nothing until the backups are answered.
  it("says nothing of the next run and the adherence until the backups were answered once", async () => {
    let answer: (value: Answer) => void = () => undefined;
    const pending = new Promise<Answer>((resolve) => {
      answer = resolve;
    });

    mount(answers({ [path("backups", A)]: () => pending }), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(4));
    for (const name of ["nightly", "weekly", "broken", "fresh"]) {
      expect(cell(name, "next")).toBe("");
      expect(cell(name, "adherence")).toBe("");
      expect(cell(name, "paused")).not.toBe("");
    }
    await act(async () => answer(list(...backups)));
    await waitFor(() => expect(cell("nightly", "next")).not.toBe(""));
    expect(cell("nightly", "adherence")).not.toBe("");
  });

  it.each([
    ["denied", { status: 403 }, "Access to the schedules of this namespace is denied"],
    ["not answered", {}, "could not be read"],
  ])("does not show a list that was %s as an empty one", async (_name, answer, text) => {
    mount(answers({ [path("schedules", A)]: answer as Answer }), chosen(A));
    const state = await screen.findByTestId("velero-schedules-unavailable");

    expect(state.textContent).toContain(text);
    expect(screen.queryByTestId("velero-schedules")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\b0 items\b/);
  });

  it("says that the cluster does not serve the schedules, which is not that there are none", async () => {
    const partly: Answer = {
      status: 200,
      body: {
        resources: Object.values(RESOURCES)
          .filter((name) => name !== "schedules")
          .map((name) => ({ name })),
      },
    };
    const { asked } = mount(answers({ [DISCOVERY]: partly }), chosen(A));
    const state = await screen.findByTestId("velero-schedules-unavailable");

    expect(state.textContent).toContain("This cluster does not serve the schedules of Velero");
    expect(asked).not.toContain(path("schedules", A));
  });

  it("keeps the schedules that were read when the next read fails, and says when they were read", async () => {
    const { installation, table, clock } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(4));
    const read = new Date(clock.now).toLocaleTimeString();

    clock.now += 60_000;
    table[path("schedules", A)] = { status: 500 };
    await act(() => installation.refresh());
    expect(rows()).toHaveLength(4);
    expect(notice("schedules")).toContain("could not be read");
    expect(notice("schedules")).toContain(`What is shown was read at ${read}`);
    // The backups were read: what the list says of the newest backup of each schedule is of this read.
    expect(cell("nightly", "newest")).toContain("nightly-20260910");
    expect(notice("backups")).toBe("");
  });

  it("says that the newest backup of each schedule is of an earlier read when the backups stop answering", async () => {
    const { installation, table, clock } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(notice("backups")).toBe("");
    const read = new Date(clock.now).toLocaleTimeString();

    clock.now += 60_000;
    table[path("backups", A)] = { status: 500 };
    await act(() => installation.refresh());
    // The column keeps what was read, and the list says of when it is.
    expect(cell("nightly", "newest")).toContain("nightly-20260910");
    expect(notice("backups")).toContain("could not be read");
    expect(notice("backups")).toContain(`What is shown was read at ${read}`);
    expect(notice("schedules")).toBe("");
    // The restores are not what a row of this list is made from: what is denied of them is not its notice.
    table[path("backups", A)] = list(...backups);
    table[path("restores", A)] = { status: 500 };
    await act(() => installation.refresh());
    expect(notice("backups")).toBe("");
    expect(notice("restores")).toBe("");
  });

  it("shows what the last read said while the installation is read again", async () => {
    let asking = false;
    let answer: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const hold = (value: Answer) => async () => {
      if (asking) await held;
      return value;
    };
    const { installation } = mount(
      answers({
        [path("schedules", A)]: hold(list(nightly, paused, invalid, unread)),
        [path("backups", A)]: hold(list(...backups)),
        [path("restores", A)]: hold({ status: 403 }),
      }),
      chosen(A),
    );
    const workspace = await open("nightly");
    const shown = () => ({
      history: [...workspace.querySelectorAll("[data-history-row]")].map((item) =>
        item.getAttribute("data-history-row"),
      ),
      counts: screen.getByTestId("velero-history-counts").textContent,
      state: screen.getByTestId("velero-schedule-history").getAttribute("data-history"),
      restores: screen.getByTestId("velero-related-restores").getAttribute("data-reference"),
      denied: notice("restores"),
      stale: screen.queryByTestId("velero-schedule-stale"),
    });
    const before = shown();

    expect(before.history).toHaveLength(4);
    expect(before.restores).toBe("inaccessible");
    expect(before.denied).toContain("access is denied");
    asking = true;
    let read: Promise<void> = Promise.resolve();

    act(() => {
      read = installation.refresh();
    });
    await waitFor(() => expect(screen.getByTestId("velero-read-time").getAttribute("data-reading")).toBe("true"));
    expect(shown()).toEqual(before);
    expect(document.body.textContent).not.toContain("stopped answering");
    await act(async () => {
      answer();
      await read;
    });
    expect(shown()).toEqual(before);
  });

  it("computes the rows of the next installation with nothing of the one before, its late answer included", async () => {
    // Velero of A submitted an hourly schedule an hour ago, with its clock two hours east of UTC, and its API server
    // writes its answers two minutes ahead of this machine.
    const submitted = NOW - 60 * 60_000;
    const hourly = scheduleObject("hourly", A, { expression: "0 * * * *", lastBackup: submitted });
    const ofA = (date: number) => ({
      schedules: { ...list(nightly, paused, invalid, unread, hourly), date, at: NOW },
      backups: { ...list(...backups, submissionOf("hourly", A, submitted, 120)), date, at: NOW },
    });
    const first = ofA(NOW + 120_000);
    const { installation, table } = mount(
      answers({ [path("schedules", A)]: first.schedules, [path("backups", A)]: first.backups }),
      chosen(A),
    );

    await waitFor(() => expect(rows()).toHaveLength(5));
    const kept = installation.serverOffset;

    expect(kept?.minutes).toBe(120);
    expect(installation.serverTime?.date).toBe(NOW + 120_000);
    // A is read again: its schedules answer at once, with the time of its API server, and its backups once B is
    // selected.
    let answer: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });

    table[path("schedules", A)] = ofA(NOW + 600_000).schedules;
    table[path("backups", A)] = async () => {
      await held;
      return ofA(NOW + 600_000).backups;
    };
    let read: Promise<void> = Promise.resolve();

    act(() => {
      read = installation.refresh();
    });
    await waitFor(() =>
      expect([Boolean(installation.read("schedules").reading), Boolean(installation.read("backups").reading)]).toEqual([
        false,
        true,
      ]),
    );
    fireEvent.change(screen.getByLabelText("Velero namespace"), { target: { value: B } });
    await waitFor(() => expect(rows()).toEqual(["nightly"]));
    const ofB = () => row("nightly").querySelector("[data-adherence]");
    const shown = () => [ofB()?.getAttribute("data-adherence"), ofB()?.getAttribute("data-reason")];
    // The schedule of B reads its expression in the zone of its own server, which none of its backups gives.
    const reads = { schedules: installation.read("schedules"), backups: installation.read("backups") };
    const own = scheduleSignal(reads.schedules.items[0], adherenceContext(reads, NOW));

    expect([own.state, own.reason]).toEqual(["not-known", "no-offset"]);
    // With the offset of A it would be computed, and said otherwise.
    expect(scheduleSignal(reads.schedules.items[0], adherenceContext(reads, NOW, kept)).state).not.toBe("not-known");
    expect(shown()).toEqual(["not-known", "no-offset"]);
    expect([installation.serverOffset, installation.serverTime]).toEqual([undefined, undefined]);
    await act(async () => {
      answer();
      await read;
    });
    expect(rows()).toEqual(["nightly"]);
    expect(shown()).toEqual(["not-known", "no-offset"]);
    expect([installation.serverOffset, installation.serverTime]).toEqual([undefined, undefined]);
  });

  it("goes from due to overdue at a tick of its clock, with no read in between", async () => {
    vi.useFakeTimers({ now: NOW });
    // Its run of today was two minutes ago, and Velero has not submitted it yet: due, within the grace.
    const tick = object(
      "Schedule",
      "tick",
      A,
      { schedule: "TZ=UTC 58 11 * * *", skipImmediately: false, template },
      { phase: "Enabled", lastBackup: "2026-09-09T11:58:00Z" },
    );
    // Each family of the installation is answered once: the reads after the first never end.
    const once = (answer: Answer) => {
      let given = false;

      return () => {
        if (given) return new Promise<Answer>(() => undefined);
        given = true;
        return Promise.resolve(answer);
      };
    };

    mount(
      answers({
        [path("schedules", A)]: once(list(nightly, paused, invalid, unread, tick)),
        [path("backups", A)]: once(list(...backups)),
      }),
      chosen(A),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const state = () => row("tick").querySelector("[data-adherence]")?.getAttribute("data-adherence");

    expect(state()).toBe("due");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60_000);
    });
    expect(state()).toBe("overdue");
  });

  it("says that the schedules, or the backups, could not be read again, each apart", async () => {
    vi.useFakeTimers({ now: NOW });
    const table = answers();
    let failing: Family | undefined;
    const answered = (family: Family) => () =>
      Promise.resolve(failing === family ? { status: 500 } : (table[path(family, A)] as Answer));
    const { installation } = mount(
      answers({ [path("schedules", A)]: answered("schedules"), [path("backups", A)]: answered("backups") }),
      chosen(A),
    );
    const notes = () =>
      scheduleSignal(nightly as unknown as ScheduleResource, adherenceOf(installation, Date.now())).notes;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(notes()).toEqual([]);
    // The clock of the views ticks every five seconds from the first drawing: the times are whole ticks, so that
    // the words of the row are of the same instant as the ones computed here.
    failing = "schedules";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_999);
    });
    const ofSchedules = notes();
    // How long ago a family was last read, as the signal says it beside what could not be read since then.
    const ago = (family: Family) => formatDuration(Date.now() - (installation.read(family).lastSuccess ?? Number.NaN));

    expect(ofSchedules).toContain(SIGNAL_WORDS.schedulesStale(ago("schedules"), SIGNAL_WORDS.since.failed));
    failing = "backups";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    const ofBackups = notes();

    expect(ofBackups).toContain(SIGNAL_WORDS.backupsStale(ago("backups"), SIGNAL_WORDS.since.failed));
    expect(ofBackups).not.toEqual(ofSchedules);
    // The row says it in the tip of its adherence, as the band does under the next run.
    const pointed = row("nightly").querySelector(".TableCell.adherence [id^='tooltip_target_']") as HTMLElement;

    fireEvent.mouseEnter(pointed);
    for (const note of ofBackups) expect(screen.getByRole("tooltip").textContent).toContain(note);
    fireEvent.mouseLeave(pointed);
  });

  it("leaves no timer once the view of a schedule, with its band, and the list close", async () => {
    vi.useFakeTimers({ now: NOW });
    const { view } = mount(answers(), chosen(A));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    act(() => openView({ kind: "schedule", name: "nightly" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByTestId("velero-schedule-adherence").getAttribute("data-adherence")).toBe("awaited");
    act(() => closeViews());
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops asking when the view closes", async () => {
    vi.useFakeTimers();
    const { asked, view } = mount(answers(), chosen(A));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    const open = asked.length;

    expect(asked.filter((address) => address === path("schedules", A)).length).toBeGreaterThanOrEqual(2);
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(asked).toHaveLength(open);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows a namespace with no schedule as a list with none", async () => {
    mount(answers({ [path("schedules", A)]: list() }), chosen(A));
    expect((await screen.findByTestId("velero-schedules-empty")).textContent).toContain(
      `No schedule is in the namespace ${A} of local-demo.`,
    );
  });
});

// The words of the clocks: over the list only when an object of the installation reports a time after the clock of
// this machine, in the band of a schedule always, and with the time of the API server when an answer carried it.
describe("clocks of the adherence", () => {
  const clocksLine = (workspace: HTMLElement) =>
    within(workspace).getByTestId("velero-schedule-adherence").querySelector('[data-line="clocks"] td')?.textContent;

  it("says nothing over the list when no object is ahead, and the clocks in the band", async () => {
    const { installation } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(4));
    const { clocks } = adherenceOf(installation, NOW);

    expect([clocks.ahead, clocks.server]).toEqual([0, undefined]);
    expect(screen.queryByTestId("velero-schedules-note")).toBeNull();
    expect(clocksLine(await open("nightly"))).toBe(clocks.words);
  });

  it("says over the list that an object is ahead of this machine, in the words of the band", async () => {
    const ahead = object(
      "Schedule",
      "ahead",
      A,
      { schedule: "0 5 * * *", skipImmediately: false, template },
      { phase: "Enabled" },
      { created: "2026-09-10T12:10:00Z" },
    );
    const { installation } = mount(
      answers({ [path("schedules", A)]: list(nightly, paused, invalid, unread, ahead) }),
      chosen(A),
    );

    await waitFor(() => expect(rows()).toHaveLength(5));
    const { clocks } = adherenceOf(installation, NOW);

    expect(clocks.ahead).toBe(10 * 60_000);
    expect(screen.getByTestId("velero-schedules-note").textContent).toContain(clocks.words);
    expect(clocksLine(await open("nightly"))).toBe(clocks.words);
  });

  it("counts by the time of the API server when the answers carried it, and says so in the band only", async () => {
    // The API server is two minutes ahead of this machine, and no object is.
    const server = { date: NOW + 120_000, at: NOW };
    const { installation } = mount(
      answers({
        [path("schedules", A)]: { ...list(nightly, paused, invalid, unread), ...server },
        [path("backups", A)]: { ...list(...backups), ...server },
      }),
      chosen(A),
    );

    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(installation.serverTime).toEqual(server);
    const { clocks } = adherenceOf(installation, NOW);
    const without = clocksOf({ schedules: installation.read("schedules"), backups: installation.read("backups") }, NOW);

    expect([clocks.server, clocks.cluster]).toEqual([120_000, NOW + 120_000]);
    expect(clocks.words).not.toBe(without.words);
    expect(screen.queryByTestId("velero-schedules-note")).toBeNull();
    expect(clocksLine(await open("nightly"))).toBe(clocks.words);
  });
});

describe("workspace of a schedule", () => {
  it("shows what Velero says of the schedule, and computes from its expression only its band of the adherence", async () => {
    const { asked, installation } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(4));
    const before = asked.length;
    const workspace = await open("nightly");
    const status = within(workspace).getByTestId("velero-schedule-status");

    expect(status.querySelector("[data-validation]")?.getAttribute("data-validation")).toBe("valid");
    expect(status.querySelector("[data-paused]")?.textContent).toBe("Not paused");
    expect(within(status).getByTestId("velero-schedule-expression").textContent).toBe("TZ=Europe/Rome 0 3 * * *");
    expect(status.textContent).toContain("Time zone: Europe/Rome, named by the expression");
    expect(status.textContent).toContain(`Last submission${new Date("2026-09-10T01:00:00Z").toLocaleString()}`);
    expect(status.textContent).toContain(NOTES.submission);
    expect(status.textContent).toContain("Last skippedNot reported");
    expect(status.textContent).toContain("Backups owned by the scheduleNot set");
    // What the release wrote into the schedule when it read it.
    expect(status.textContent).toContain("Skip immediatelyNo");
    expect(status.textContent).toContain(A);
    expect(within(workspace).queryByTestId("velero-schedule-notes")).toBeNull();
    expect(within(workspace).queryByTestId("velero-schedule-messages")).toBeNull();
    // What the view computes from the expression is in the band of the adherence, and nowhere else (SCHED-03
    // as SPEC-0013 restates it).
    const band = within(workspace).getByTestId("velero-schedule-adherence");

    expect(band.getAttribute("data-adherence")).toBe(
      scheduleSignal(nightly as unknown as ScheduleResource, adherenceOf(installation, NOW)).state,
    );
    expect(band.textContent).toMatch(/next run/i);
    const outside = workspace.cloneNode(true) as HTMLElement;

    outside.querySelector('[data-testid="velero-schedule-adherence"]')?.remove();
    expect(outside.textContent).not.toMatch(/next run|overdue|missed|expected run|is late/i);
    expect(asked).toHaveLength(before);
    expect(document.activeElement).toBe(screen.getByTestId("velero-back"));
    expect(screen.getByTestId("velero-back").textContent).toContain("Schedules");
  });

  it("says of an expression without a time zone that it is read in the one of the server", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("weekly");
    const status = within(workspace).getByTestId("velero-schedule-status").textContent ?? "";

    expect(status).toContain("Time zone: The one of the Velero server, which this view does not read");
    expect(status).not.toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("says of a paused schedule that its validation is the one written before the pause", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("weekly");
    const status = within(workspace).getByTestId("velero-schedule-status");

    expect(status.querySelector("[data-paused]")?.getAttribute("data-paused")).toBe("paused");
    expect(status.querySelector("[data-validation]")?.textContent).toBe("check_circle_outlineEnabled");
    expect(status.textContent).toContain(`Last skipped${new Date("2026-09-02T09:00:00Z").toLocaleString()}`);
    expect(within(workspace).getByTestId("velero-schedule-notes").textContent).toBe(NOTES.paused);
  });

  it("shows the validation errors of a schedule that is invalid, and the expression as it is written", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("broken");

    expect(within(workspace).getByTestId("velero-schedule-expression").textContent).toBe("every night");
    expect(within(workspace).getByTestId("velero-schedule-status").textContent).toContain("Failed validation");
    expect(within(workspace).getByTestId("velero-schedule-messages").textContent).toBe(
      "invalid schedule: expected exactly 5 fields, found 2",
    );
    expect(within(workspace).getByTestId("velero-history-counts").textContent).toBe(
      "No backup of this schedule is among the ones that exist.",
    );
    expect(within(workspace).queryByTestId("velero-history-strip")).toBeNull();
    expect(within(workspace).queryByTestId("velero-history-list")).toBeNull();
  });

  it("says that Velero has not read a schedule that reports no phase, and what skipping does", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("fresh");
    const notes = [...within(workspace).getByTestId("velero-schedule-notes").querySelectorAll("li")].map(
      (note) => note.textContent,
    );

    expect(notes).toEqual([NOTES.notRead, NOTES.skip]);
    expect(within(workspace).getByTestId("velero-schedule-status").textContent).toContain("Skip immediatelyYes");
    expect(within(workspace).getByTestId("velero-schedule-status").textContent).toContain("Not reported");
  });

  it("says that a schedule is not there, or that it is not known, and not the one for the other", async () => {
    const { installation, table } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(4));
    act(() => openView({ kind: "schedule", name: "removed" }));
    expect((await screen.findByTestId("velero-schedule-missing")).textContent).toContain("No schedule of this name");
    table[path("schedules", B)] = { status: 403 };
    fireEvent.change(screen.getByLabelText("Velero namespace"), { target: { value: B } });
    await waitFor(() => expect(installation.read("schedules").status).toBe("forbidden"));
    // The views of an installation close when another one is selected.
    expect(openViews()).toEqual([]);
    act(() => openView({ kind: "schedule", name: "removed" }));
    expect(screen.getByTestId("velero-schedule-unknown").textContent).toContain("It is not known to be absent");
  });

  it("says in words that a schedule was created again under the name that is open", async () => {
    const { installation, table } = mount(answers(), chosen(A));
    const workspace = await open("nightly");

    expect(workspace.getAttribute("data-schedule-uid")).toBe(`${A}-schedule-nightly`);
    expect(screen.queryByTestId("velero-schedule-replaced")).toBeNull();
    const again = object("Schedule", "nightly", A, { schedule: "0 5 * * *" }, { phase: "Enabled" });

    table[path("schedules", A)] = list({ ...again, metadata: { ...again.metadata, uid: "created-again" } });
    await act(() => installation.refresh());
    expect(screen.getByTestId("velero-schedule-workspace").getAttribute("data-schedule-uid")).toBe("created-again");
    expect(screen.getByTestId("velero-schedule-expression").textContent).toBe("0 5 * * *");
    expect(screen.getByTestId("velero-schedule-replaced").textContent).toContain(
      "This is another schedule of the same name",
    );
  });

  it("does not show the answer of the installation that was selected before", async () => {
    let answer: (value: Answer) => void = () => undefined;
    const late = new Promise<Answer>((resolve) => {
      answer = resolve;
    });
    const { installation } = mount(answers({ [path("schedules", A)]: () => late }), chosen(A));

    await waitFor(() => expect(installation.namespace).toBe(A));
    fireEvent.change(await screen.findByLabelText("Velero namespace"), { target: { value: B } });
    await waitFor(() => expect(rows()).toEqual(["nightly"]));
    await act(async () => {
      answer(list(nightly, paused, invalid, unread));
      await late;
    });
    expect(rows()).toEqual(["nightly"]);
    expect(installation.read("schedules").items).toHaveLength(1);
  });

  it("has no control that writes: the way back, the ways to other views and the marks of the line", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("nightly");
    const controls = [...workspace.querySelectorAll("button, a, input, select, textarea")].map(
      (control) => control.getAttribute("data-testid") ?? `mark ${control.getAttribute("data-strip-mark")}`,
    );

    expect(controls.filter((control) => !control.startsWith("mark ") && !control.startsWith("velero-open-"))).toEqual([
      "velero-back",
    ]);
    expect(workspace.textContent).not.toMatch(/\b(delete|edit|remove|pause now|resume|run now|trigger)\b/i);
  });
});

describe("history of a schedule", () => {
  it("lists the backups of the schedule from the newest, and counts what it holds", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("nightly");

    expect(within(workspace).getByTestId("velero-schedule-history").getAttribute("data-history")).toBe("listed");
    expect(history()).toEqual(["nightly-20260910", "nightly-20260909", "nightly-20260908", "nightly-20260907"]);
    expect(within(workspace).getByTestId("velero-history-counts").textContent).toBe(
      "4 backups that exist: 2 completed; 2 ended with a failure.",
    );
    expect(workspace.textContent).toContain("These are the backups that exist now");
    // None of them is one the release waits for before it submits another.
    expect(workspace.textContent).not.toContain("Velero submits no backup");
    // The backups of another schedule, and the ones of none, are not of this history.
    expect(history()).not.toContain("weekly-20260830");
    expect(history()).not.toContain("by-hand");
    const newest = document.querySelector('[data-history-row="nightly-20260910"]') as HTMLElement;

    expect(newest.querySelector("[data-time]")?.getAttribute("data-time")).toBe("creation");
    expect(newest.textContent).toContain("(created, did not start)");
    expect(newest.textContent).toContain("Failed validation");
    expect(newest.textContent).toContain("Not started");
    expect(
      (document.querySelector('[data-history-row="nightly-20260909"]') as HTMLElement).querySelector("[data-time]")
        ?.textContent,
    ).toBe(`${new Date("2026-09-09T01:00:00Z").toLocaleString()} (started)`);
    expect(within(workspace).getByTestId("velero-schedule-newest").textContent).toContain("nightly-20260910");
    expect(within(workspace).getByTestId("velero-schedule-newest").textContent).toContain("1 validation error");
  });

  it("draws each backup on the line of time, and nothing between two of them", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("nightly");
    const strip = within(workspace).getByTestId("velero-history-strip");

    expect(marks()).toEqual(["nightly-20260907", "nightly-20260908", "nightly-20260909", "nightly-20260910"]);
    expect(within(strip).getByTestId("velero-history-from").textContent).toBe(
      new Date("2026-09-07T01:00:00Z").toLocaleString(),
    );
    const drawn = [...strip.querySelectorAll<HTMLElement>("[data-strip-mark]")];

    expect(drawn.map((mark) => mark.getAttribute("data-failing"))).toEqual(["false", "true", "false", "true"]);
    expect(drawn.map((mark) => mark.getAttribute("data-not-started"))).toEqual(["false", "false", "false", "true"]);
    expect(drawn.map((mark) => Number.parseFloat(mark.style.left))).toEqual(
      [...drawn.map((mark) => Number.parseFloat(mark.style.left))].sort((one, other) => one - other),
    );
    // What a mark is, is said in words: a color says nothing to who cannot tell it from another.
    expect(drawn[1].getAttribute("aria-label")).toContain("nightly-20260908, Partially failed, 2 errors, Started");
    expect(drawn[3].getAttribute("aria-label")).toContain(
      "nightly-20260910, Failed validation, 1 validation error, Created, did not start",
    );
    expect(drawn[3].textContent).toBe("block");
    expect(strip.textContent).not.toMatch(/miss|expected|overdue|gap/i);
    expect(strip.querySelectorAll("button")).toHaveLength(4);
  });

  it("leads from a mark, and from a row of the list, to the backup and back to the schedule", async () => {
    mount(answers(), chosen(A));
    await open("nightly");
    fireEvent.click(document.querySelector('[data-strip-mark="nightly-20260908"]') as HTMLElement);
    await screen.findByTestId("velero-backup-workspace");
    expect(openViews()).toEqual([
      { kind: "schedule", name: "nightly" },
      { kind: "backup", name: "nightly-20260908" },
    ]);
    expect(screen.getByTestId("velero-schedules-page")).toBeTruthy();
    expect(screen.getByTestId("velero-back").textContent).toContain("Schedules / nightly");
    // The backup leads to its schedule, which is the view it was opened from: the way does not get longer.
    fireEvent.click(within(screen.getByTestId("velero-reference-Schedule-nightly")).getByRole("button"));
    await screen.findByTestId("velero-schedule-workspace");
    expect(openViews()).toEqual([{ kind: "schedule", name: "nightly" }]);
    fireEvent.click(
      within(document.querySelector('[data-history-row="nightly-20260909"]') as HTMLElement).getByRole("button"),
    );
    await screen.findByTestId("velero-backup-workspace");
    fireEvent.keyDown(screen.getByTestId("velero-backup-workspace"), { key: "Escape" });
    await screen.findByTestId("velero-schedule-workspace");
    fireEvent.click(screen.getByTestId("velero-back"));
    await waitFor(() => expect(screen.queryByTestId("velero-schedule-workspace")).toBeNull());
    expect(document.activeElement?.getAttribute("data-schedule-row")).toBe("nightly");
  });

  it("draws as one mark the backups that are close, and shows them alone in the list when it is asked", async () => {
    const close = [
      object("Backup", "hourly-old", A, template, ran("2026-08-01"), of("nightly")),
      ...["01", "02", "03"].map((hour) =>
        object(
          "Backup",
          `hourly-${hour}`,
          A,
          template,
          {
            ...ran("2026-09-09", hour === "02" ? "Failed" : "Completed", hour === "02" ? 1 : 0),
            startTimestamp: `2026-09-09T${hour}:00:00Z`,
          },
          of("nightly"),
        ),
      ),
    ];

    mount(answers({ [path("backups", A)]: list(...close) }), chosen(A));
    const workspace = await open("nightly");

    expect(marks()).toEqual(["hourly-old", "hourly-03,hourly-02,hourly-01"]);
    const group = document.querySelector('[data-strip-mark="hourly-03,hourly-02,hourly-01"]') as HTMLElement;

    expect(group.textContent).toBe("3");
    expect(group.getAttribute("data-failing")).toBe("true");
    expect(group.getAttribute("aria-label")).toContain(
      "3 backups close to each other. one of them at least with a failure",
    );
    expect(group.getAttribute("aria-pressed")).toBe("false");
    expect(history()).toHaveLength(4);
    fireEvent.click(group);
    expect(history()).toEqual(["hourly-03", "hourly-02", "hourly-01"]);
    expect(group.getAttribute("aria-pressed")).toBe("true");
    expect(within(workspace).getByTestId("velero-history-shown").textContent).toContain(
      "The 3 backups of one mark are shown.",
    );
    // The view stays the one of the schedule: a mark of more than one backup opens none of them.
    expect(openViews()).toEqual([{ kind: "schedule", name: "nightly" }]);
    fireEvent.click(within(workspace).getByText("Show all"));
    expect(history()).toHaveLength(4);
    expect(within(workspace).queryByTestId("velero-history-shown")).toBeNull();
    // The button went away with what it said: the focus is on the mark that was chosen.
    expect(document.activeElement).toBe(group);
    expect(group.getAttribute("aria-pressed")).toBe("false");
  });

  it("says of a mark that was chosen how many of its backups are there now", async () => {
    const old = object("Backup", "hourly-old", A, template, ran("2026-08-01"), of("nightly"));
    const close = ["01", "02", "03"].map((hour) =>
      object(
        "Backup",
        `hourly-${hour}`,
        A,
        template,
        { ...ran("2026-09-09"), startTimestamp: `2026-09-09T${hour}:00:00Z` },
        of("nightly"),
      ),
    );
    const { installation, table } = mount(answers({ [path("backups", A)]: list(old, ...close) }), chosen(A));
    const said = () => screen.getByTestId("velero-history-shown").textContent;
    const read = async (...items: unknown[]) => {
      table[path("backups", A)] = list(old, ...items);
      await act(() => installation.refresh());
    };

    await open("nightly");
    fireEvent.click(document.querySelector('[data-strip-mark="hourly-03,hourly-02,hourly-01"]') as HTMLElement);
    expect(said()).toBe("The 3 backups of one mark are shown. Show all");
    // One of them expired at the read after: the number is of the ones that are shown.
    await read(close[0], close[2]);
    expect(history()).toEqual(["hourly-03", "hourly-01"]);
    expect(said()).toBe("The 2 backups of one mark are shown. Show all");
    await read(close[2]);
    expect(history()).toEqual(["hourly-03"]);
    expect(said()).toBe("One backup of one mark is shown. Show all");
    await read();
    expect(history()).toEqual([]);
    expect(said()).toBe("No backup of the mark that was chosen is among the ones that exist now. Show all");
    // What is said is said to who does not see it as well, when it changes.
    expect(screen.getByTestId("velero-history-shown").querySelector('[role="status"]')?.textContent).toBe(
      "No backup of the mark that was chosen is among the ones that exist now.",
    );
    fireEvent.click(screen.getByText("Show all"));
    expect(screen.queryByTestId("velero-history-shown")).toBeNull();
    expect(history()).toEqual(["hourly-old"]);
    // The mark is not there any more: the focus is on the way back, and not on nothing.
    expect(document.activeElement?.getAttribute("data-testid")).toBe("velero-back");
  });

  it("writes the number of a mark of many in the room of a mark, and names the newest of them", async () => {
    // Twelve hundred backups in twenty minutes of the same day are one mark, after one of a week before.
    const crowd = [
      object("Backup", "first", A, template, ran("2026-09-02"), of("nightly")),
      ...Array.from({ length: 1200 }, (_, index) =>
        object(
          "Backup",
          `crowd-${String(index).padStart(4, "0")}`,
          A,
          template,
          {
            ...ran("2026-09-09"),
            startTimestamp: new Date(Date.parse("2026-09-09T03:00:00Z") + index * 1000)
              .toISOString()
              .replace(".000Z", "Z"),
          },
          of("nightly"),
        ),
      ),
    ];

    mount(answers({ [path("backups", A)]: list(...crowd) }), chosen(A));
    await open("nightly");
    const drawn = [...document.querySelectorAll<HTMLElement>("[data-strip-mark]")];
    const group = drawn[1];

    expect(drawn).toHaveLength(2);
    expect(group.textContent).toBe("1k");
    expect(group.querySelector("span")?.getAttribute("data-characters")).toBe("2");
    expect(group.getAttribute("data-strip-held")).toBe("1200");
    expect((group.getAttribute("data-strip-mark") ?? "").split(",")).toHaveLength(20);
    expect(group.getAttribute("aria-label")).toMatch(
      /^1200 backups close to each other\. crowd-1199, Completed, .+\. crowd-1195, Completed, [^.]+\. and 1195 more$/,
    );
    // Every backup of the mark is shown when the mark is chosen, the ones it does not name as well.
    fireEvent.click(group);
    expect(screen.getByTestId("velero-history-shown").textContent).toContain("The 1200 backups of one mark are shown.");
  });

  it("shows twenty backups at a time, from the newest, and the others when they are asked", async () => {
    const many = Array.from({ length: 45 }, (_, index) =>
      object(
        "Backup",
        `nightly-${String(index + 1).padStart(2, "0")}`,
        A,
        template,
        {
          ...ran("2026-07-01"),
          startTimestamp: new Date(Date.parse("2026-07-01T01:00:00Z") + index * 86_400_000)
            .toISOString()
            .replace(".000Z", "Z"),
        },
        of("nightly"),
      ),
    );

    mount(answers({ [path("backups", A)]: list(...many) }), chosen(A));
    const workspace = await open("nightly");

    expect(history()).toHaveLength(20);
    expect(history()[0]).toBe("nightly-45");
    expect(within(workspace).getByTestId("velero-history-counts").textContent).toContain("45 backups that exist");
    expect(within(workspace).getByTestId("velero-history-more").textContent).toBe("Show 20 more of the 25 older ones");
    fireEvent.click(within(workspace).getByTestId("velero-history-more"));
    expect(history()).toHaveLength(40);
    fireEvent.click(within(workspace).getByTestId("velero-history-more"));
    expect(history()).toHaveLength(45);
    expect(within(workspace).queryByTestId("velero-history-more")).toBeNull();
    // Every backup is on the line, in a mark of its own or with the ones close to it.
    expect(marks().flatMap((mark) => mark?.split(",") ?? [])).toHaveLength(45);
  });

  it.each([
    ["denied", { status: 403 }, "inaccessible", "access is denied"],
    ["not answered", {}, "unknown", "could not be read"],
  ])(
    "says that a history whose backups were %s is not known, and not that it is empty",
    async (_name, answer, state, reason) => {
      mount(answers({ [path("backups", A)]: answer as Answer }), chosen(A));
      const workspace = await open("nightly");
      const shown = within(workspace).getByTestId("velero-schedule-history");

      expect(shown.getAttribute("data-history")).toBe(state);
      expect(shown.textContent).toContain(reason);
      expect(shown.textContent).toContain("is not known, which is not that it has none");
      expect(within(workspace).queryByTestId("velero-history-counts")).toBeNull();
      expect(within(workspace).queryByTestId("velero-history-strip")).toBeNull();
      expect(within(workspace).getByTestId("velero-schedule-status").textContent).toContain("Newest backupNot known");
      expect(notice("backups")).toContain(reason);
      // The schedule itself is read, and shown.
      expect(within(workspace).getByTestId("velero-schedule-expression").textContent).toBe("TZ=Europe/Rome 0 3 * * *");
    },
  );

  it("keeps the history that was read when the backups stop answering, and says when it was read", async () => {
    const { installation, table, clock } = mount(answers(), chosen(A));
    const workspace = await open("nightly");
    const read = new Date(clock.now).toLocaleTimeString();

    clock.now += 60_000;
    table[path("backups", A)] = { status: 500 };
    await act(() => installation.refresh());
    expect(history()).toHaveLength(4);
    expect(within(workspace).getByTestId("velero-schedule-history").textContent).toContain(
      `They were read at ${read}: the backups could not be read again.`,
    );
    expect(within(workspace).queryByTestId("velero-schedule-stale")).toBeNull();
    table[path("schedules", A)] = { status: 500 };
    await act(() => installation.refresh());
    expect(within(workspace).getByTestId("velero-schedule-stale").textContent).toContain(
      "The schedules could not be read again",
    );
  });

  it("says that Velero submits no other backup while one of the schedule is in progress", async () => {
    mount(
      answers({
        [path("backups", A)]: list(
          object("Backup", "nightly-running", A, template, ran("2026-09-10", "InProgress"), of("nightly")),
        ),
      }),
      chosen(A),
    );
    const workspace = await open("nightly");

    expect(within(workspace).getByTestId("velero-schedule-history").textContent).toContain(
      "Velero submits no backup of a schedule while one of its backups reports no phase, New or InProgress: one of these does.",
    );
    expect(within(workspace).getByTestId("velero-history-counts").textContent).toBe(
      "1 backup that exists: 1 in flight.",
    );
    // The last submission has the newest backup beside it, which is at work and carries no failure.
    const status = within(workspace).getByTestId("velero-schedule-status");
    const newest = within(status).getByTestId("velero-schedule-newest");

    expect(status.textContent).toContain(`Last submission${new Date("2026-09-10T01:00:00Z").toLocaleString()}`);
    expect(within(newest).getByRole("button").textContent).toBe("nightly-running");
    expect(newest.querySelector("[data-signal]")?.getAttribute("data-signal")).toBe("none");
    expect(newest.textContent).not.toMatch(/completed|failed/i);
  });
});

describe("template and restores of a schedule", () => {
  it("shows the template as the schedule carries it, and what it refers to", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("nightly");
    const scope = (id: string) => workspace.querySelector(`[data-scope="${id}"]`)?.textContent;

    expect(scope("included-namespaces")).toBe("shop");
    expect(scope("retention")).toBe("720h0m0s");
    expect(scope("excluded-namespaces")).toBe("Not set");
    expect(scope("cluster-resources")).toBe("Not set");
    expect(within(workspace).getByTestId("velero-schedule-template").textContent).not.toMatch(/undefined|null|NaN/);
    const location = within(workspace).getByTestId("velero-reference-BackupStorageLocation-default");

    expect(location.getAttribute("data-reference")).toBe("resolved");
    expect(location.textContent).toContain("Available, ReadWrite");
    expect(
      within(workspace).getByTestId("velero-reference-VolumeSnapshotLocation-snapshots").getAttribute("data-reference"),
    ).toBe("resolved");
    expect(within(workspace).queryByTestId("velero-schedule-location-warning")).toBeNull();
  });

  it.each([
    ["weekly", "archive", "it is read-only"],
    ["broken", "removed", "a location that is not there"],
  ])("says that the backups of %s go to a location that does not take them", async (name, location, warning) => {
    mount(answers(), chosen(A));
    const workspace = await open(name);

    expect(within(workspace).getByTestId(`velero-reference-BackupStorageLocation-${location}`)).toBeTruthy();
    expect(within(workspace).getByTestId("velero-schedule-location-warning").textContent).toContain(warning);
  });

  it("names every location marked default when more than one is, and picks none for the operator", async () => {
    const marked = (name: string, created: string, spec: object, status: object) => {
      const location = object("BackupStorageLocation", name, A, { default: true, ...spec }, status);

      return { ...location, metadata: { ...location.metadata, creationTimestamp: created } };
    };

    mount(
      answers({
        [path("storageLocations", A)]: list(
          marked("first", "2026-09-01T00:00:00Z", { accessMode: "ReadWrite" }, { phase: "Available" }),
          marked("second", "2026-09-02T00:00:00Z", { accessMode: "ReadOnly" }, { phase: "Available" }),
        ),
      }),
      chosen(A),
    );
    const workspace = await open("fresh");
    const fallback = within(workspace).getByTestId("velero-schedule-default-location");

    expect(fallback.getAttribute("data-default")).toBe("many-marked");
    expect(fallback.textContent).toBe(
      "Not set, and 2 locations of this installation are marked default: first, second. The reviewed release sends a backup that names no location to the first of them it finds, and keeps marked the one created last, which is second.",
    );
    expect(fallback.textContent).not.toContain("Velero uses the location marked default");
    // Each one that is named is a way to its view.
    expect(
      within(fallback)
        .getAllByRole("button")
        .map((button) => button.getAttribute("data-testid")),
    ).toEqual(["velero-open-storage-location-first", "velero-open-storage-location-second"]);
    expect(within(workspace).getByTestId("velero-schedule-location-warning").textContent).toContain(
      "second: The release refuses a backup sent to this location: it is read-only.",
    );
  });

  it("says where the backups go when the template names no location", async () => {
    const { installation, table } = mount(answers(), chosen(A));
    const workspace = await open("fresh");
    const fallback = () => within(workspace).getByTestId("velero-schedule-default-location");

    expect(fallback().getAttribute("data-default")).toBe("marked");
    expect(fallback().textContent).toBe(
      "Not set: Velero uses the location marked default, default (Available, ReadWrite).",
    );
    table[path("storageLocations", A)] = list(
      object("BackupStorageLocation", "archive", A, { accessMode: "ReadOnly" }, { phase: "Available" }),
    );
    await act(() => installation.refresh());
    expect(fallback().getAttribute("data-default")).toBe("none-marked");
    expect(fallback().textContent).toContain("Velero uses the one the server names in its settings");
    table[path("storageLocations", A)] = { status: 403 };
    await act(() => installation.refresh());
    // What was read before stays, and is said of an earlier read by the notice of the family.
    expect(notice("storageLocations")).toContain("access is denied");
  });

  it("lists the restores that name the schedule, and says that one may be of a backup of it", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("nightly");
    const restores = within(workspace).getByTestId("velero-related-restores");

    expect(
      within(restores)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["restore-from-nightly", "restore-of-a-backup"]);
    expect(restores.textContent).toContain("restore-from-nightly (Completed)");
    expect(restores.textContent).toContain("restore-of-a-backup (Not reported)");
    expect(within(workspace).getByTestId("velero-schedule-restores-note").textContent).toContain(
      "was asked from it, or from a backup of it",
    );
    fireEvent.click(within(restores).getByText("restore-of-a-backup"));
    await screen.findByTestId("velero-restore-workspace");
    // The restore names the schedule, which is now a way to its view.
    expect(within(screen.getByTestId("velero-reference-Schedule-nightly")).getByRole("button").textContent).toBe(
      "nightly",
    );
    expect(screen.getByTestId("velero-back").textContent).toContain("Schedules / nightly");
    // The way back leads to the schedule the restore was opened from.
    fireEvent.click(screen.getByTestId("velero-back"));
    await waitFor(() => expect(screen.queryByTestId("velero-restore-workspace")).toBeNull());
    expect(screen.getByTestId("velero-schedule-name").textContent).toBe("nightly");
    expect(screen.getByTestId("velero-back").textContent).toBe("arrow_backSchedules");
  });

  it("says that no restore names a schedule when the restores were read and none does", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("broken");
    const restores = within(workspace).getByTestId("velero-related-restores");

    expect(restores.getAttribute("data-reference")).toBe("listed");
    expect(restores.textContent).toBe("None");
    expect(within(restores).queryAllByRole("button")).toEqual([]);
  });

  it("does not say that no restore names the schedule when the restores cannot be read", async () => {
    mount(answers({ [path("restores", A)]: { status: 403 } }), chosen(A));
    const workspace = await open("nightly");
    const restores = within(workspace).getByTestId("velero-related-restores");

    expect(restores.getAttribute("data-reference")).toBe("inaccessible");
    expect(restores.textContent).not.toMatch(/None|\b0\b/);
  });
});

describe("way from a backup to its schedule", () => {
  it("leads from the backup to the schedule, over the list of the backups, and back", async () => {
    mount(answers(), chosen(A), BackupsPage);
    await waitFor(() => expect(rows("backup")).toContain("nightly-20260909"));
    fireEvent.click(screen.getByText("nightly-20260909", { selector: "[data-backup-row]" }));
    fireEvent.click(within(await screen.findByTestId("velero-reference-Schedule-nightly")).getByRole("button"));
    const workspace = await screen.findByTestId("velero-schedule-workspace");

    expect(screen.getByTestId("velero-backups-page")).toBeTruthy();
    expect(screen.getByTestId("velero-back").textContent).toContain("Backups / nightly-20260909");
    expect(within(workspace).getByTestId("velero-schedule-expression").textContent).toBe("TZ=Europe/Rome 0 3 * * *");
    fireEvent.keyDown(workspace, { key: "Escape" });
    await screen.findByTestId("velero-backup-workspace");
    // A backup that names a schedule that is not there has a name with its reason, and no way.
    act(() => closeViews());
    act(() => openView({ kind: "backup", name: "by-hand" }));
    expect((await screen.findByTestId("velero-reference-Schedule-none")).textContent).toContain("names no schedule");
  });
});

describe("details of the host for a schedule", () => {
  const extension = { name: "@freelensapp/velero-extension" } as Renderer.LensExtension;
  const details = (resource: object, preferences: Preferences) => {
    const installation = new Installation({
      cluster: { id: "cluster-a", name: "local-demo" },
      read: async () => {
        throw new Error("The details of the host ask nothing of the cluster");
      },
      now: () => 0,
      storage: heldPreferences(preferences),
    });

    return render(
      <ScheduleDetails object={hostObject(Schedule, resource)} extension={extension} installation={installation} />,
    );
  };
  const item = (name: string) => drawerValue(name);

  it("reads the schedule as the views do, and leads to the workspace of the installation selected", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(4));
    const shown = {
      paused: cell("weekly", "paused"),
      expression: cell("weekly", "schedule"),
      submitted: cell("weekly", "submitted"),
    };

    cleanup();
    details(paused, chosen(A));
    expect(item("Validation")).toBe("Enabled");
    expect(item("Paused")).toBe(shown.paused);
    expect(item("Schedule")).toBe(shown.expression);
    expect(item("Last submission")).toBe(shown.submitted);
    expect(item("Time zone")).toBe("The one of the Velero server, which this view does not read");
    expect(item("Notes")).toBe(NOTES.paused);
    expect(screen.getByTestId("velero-schedule-details-link").getAttribute("href")).toBe(
      "/extension/freelensapp--velero-extension/schedules?view=schedule%2Fweekly",
    );
    // The views never read this installation, and no namespace is the one it reads: the adherence is computed
    // with nothing of it, and says so.
    const signal = scheduleSignal(paused as unknown as ScheduleResource, unreadAdherence(NOW));

    expect(item("Next run")).toBe(signal.next.text);
    expect(item("Adherence")).toContain(signal.label);
    expect(item("Adherence")).toContain(signal.words);
  });

  it("says the next run and the adherence of the row of each state, with what the views read, and asks nothing", async () => {
    const { all, table } = eachState();
    const { installation, asked } = mount(table, chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(all.length));
    const shown = Object.fromEntries(
      all.map(({ metadata: { name } }) => [
        name,
        { next: cell(name, "next"), adherence: row(name).querySelector("[data-adherence]")?.textContent },
      ]),
    );
    const before = asked.length;

    cleanup();
    for (const resource of all) {
      const drawn = render(
        <ScheduleDetails object={hostObject(Schedule, resource)} extension={extension} installation={installation} />,
      );
      const signal = scheduleSignal(resource as unknown as ScheduleResource, adherenceOf(installation, NOW));
      const drawer = screen.getByTestId("velero-schedule-details");

      expect(drawer.querySelector("[data-next]")?.textContent).toBe(shown[resource.metadata.name].next);
      // Beside an instant, its date as the host writes one.
      expect(drawer.querySelector("[data-host-time]")?.textContent ?? null).toBe(
        signal.next.kind === "at"
          ? `${BAND_WORDS.hostTime} ${new Date(signal.next.at).toISOString().slice(0, 19)}Z`
          : null,
      );
      expect(item("Adherence")).toContain(shown[resource.metadata.name].adherence);
      expect(item("Adherence")).toContain(signal.words);
      drawn.unmount();
    }
    expect(asked).toHaveLength(before);
  });

  it("says how old the read of the backups is when no view asks again, or when it is older than their period", async () => {
    const { installation, view } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(4));
    const read = installation.read("backups").lastSuccess ?? Number.NaN;
    const words = () =>
      screen.getByTestId("velero-schedule-details").querySelector("[data-adherence-words]")?.textContent ?? "";
    const drawn = (now: number) => {
      vi.setSystemTime(now);
      return render(
        <ScheduleDetails object={hostObject(Schedule, nightly)} extension={extension} installation={installation} />,
      );
    };

    // The list is open, and asks again every period: a read of now is not said.
    expect(installation.watched).toBe(true);
    let details = drawn(NOW);

    for (const closed of [true, false]) {
      expect(words()).not.toContain(SIGNAL_WORDS.readOfTheViews(agoText(read, NOW), closed));
    }
    details.unmount();
    // Older than the period while a view is open: its age is said.
    details = drawn(NOW + 20_000);
    expect(words()).toContain(SIGNAL_WORDS.readOfTheViews(agoText(read, NOW + 20_000), false));
    details.unmount();
    // The last view closes and the reads stop: twelve minutes later the details say how old what they computed
    // with is, and why.
    view.unmount();
    expect(installation.watched).toBe(false);
    drawn(NOW + 12 * 60_000);
    expect(words()).toContain(SIGNAL_WORDS.readOfTheViews(agoText(read, NOW + 12 * 60_000), true));
  });

  it("computes a schedule of another namespace with nothing of the installation the views read", async () => {
    // The views read A, whose server is two hours east of UTC by the backup of a submission of A.
    const submitted = NOW - 60 * 60_000;
    const hourly = scheduleObject("hourly", A, { expression: "0 * * * *", lastBackup: submitted });
    const own = submissionOf("hourly", A, submitted, 120);
    const { installation } = mount(
      answers({
        [path("schedules", A)]: list(nightly, paused, invalid, unread, hourly),
        [path("backups", A)]: list(...backups, own),
      }),
      chosen(A),
    );

    await waitFor(() => expect(installation.serverOffset?.minutes).toBe(120));
    // A schedule of B whose expression names no zone: with what was read of A it would be computed, with the
    // offset of the server of A.
    const ofB = scheduleObject("nightly", B, { expression: "0 1 * * *" });

    expect(scheduleSignal(ofB, adherenceOf(installation, NOW)).state).not.toBe("not-known");
    render(<ScheduleDetails object={hostObject(Schedule, ofB)} extension={extension} installation={installation} />);
    const mark = screen.getByTestId("velero-schedule-details").querySelector("[data-adherence]");

    expect([mark?.getAttribute("data-adherence"), mark?.getAttribute("data-reason")]).toEqual([
      "not-known",
      "no-offset",
    ]);
    expect(item("Adherence")).not.toContain("UTC+02:00");
    expect(item("Adherence")).not.toContain(own.metadata.name);
  });

  it("has a clock of its own, which ends with the details", () => {
    vi.useFakeTimers({ now: NOW });
    const drawn = details(paused, chosen(A));

    expect(vi.getTimerCount()).toBe(1);
    drawn.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives no link to a schedule of a namespace that is not the one selected", () => {
    details(invalid, chosen(B));
    expect(screen.queryByTestId("velero-schedule-details-link")).toBeNull();
    expect(screen.getByTestId("velero-schedule-details-elsewhere").textContent).toContain(A);
    expect(item("Validation errors")).toBe("invalid schedule: expected exactly 5 fields, found 2");
    // Of a namespace the installation does not read, the adherence is computed with nothing of its installation.
    const signal = scheduleSignal(invalid as unknown as ScheduleResource, unreadAdherence(NOW));

    expect(item("Next run")).toBe(signal.next.text);
    expect(item("Adherence")).toContain(signal.label);
  });
});
