// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { virtualList } from "../../../test/host-components";
import { LINE_BOUND, logLine, parseLog, searchLog, shownLines } from "../../common/artifact-log";
import { LINE, ROOM, ROWS_BOUND } from "./artifact-lines";
import { CONTENT } from "./artifact-viewer";
import { LogViewer, searchWords } from "./log-viewer";

// The functions that read the text are the ones of the log, and each call of them is counted: what the
// viewer reads, and how many times, is what it holds beside the text.
vi.mock("../../common/artifact-log", async (original) => {
  const log = await original<typeof import("../../common/artifact-log")>();

  return {
    ...log,
    parseLog: vi.fn(log.parseLog),
    shownLines: vi.fn(log.shownLines),
    searchLog: vi.fn(log.searchLog),
    logLine: vi.fn(log.logLine),
  };
});

const ROOM_OF_THE_TESTS = virtualList.room;

// Entries as the server of the reviewed release writes them, in its two formats.
const entry = (level: string, message: string, fields = 'backup=velero/nightly logSource="pkg/backup/backup.go:1"') =>
  `time="2026-10-04T18:08:23Z" level=${level} msg="${message}" ${fields}`;
const json = (level: string, message: string) =>
  JSON.stringify({ backup: "velero/nightly", level, msg: message, time: "2026-10-04T18:08:23Z" });

const TEXT = [
  entry("info", "Backing up item"),
  entry("error", "Error backing up item: the store refused"),
  entry("warning", "Volume skipped"),
  entry("debug", "Skipping action"),
  // The words of a message say nothing of the level of its entry.
  entry("info", "the plugin wrote level=error before BACKING off"),
  "a line that is no entry, and has no level",
].join("\n");

const list = () => screen.getByTestId("log-text");
const scroller = () => list().querySelector<HTMLElement>(".list") as HTMLElement;
const rows = () => [...list().querySelectorAll<HTMLElement>("[data-text-line]")];
const numbers = () => rows().map((row) => Number(row.dataset.textLine));
const row = (number: number) => screen.getByTestId(`log-line-${number}`);
const shown = (number: number) => screen.getByTestId(`log-line-${number}-text`);
const level = (name: string) => screen.getByTestId(`log-level-${name}`);
const field = () => screen.getByTestId("log-search") as HTMLInputElement;
const status = () => screen.getByTestId("log-search-status").textContent;
const count = () => screen.getByTestId("log-count").textContent;
const type = (words: string) => fireEvent.change(field(), { target: { value: words } });
const enter = (shiftKey = false) => fireEvent.keyDown(field(), { key: "Enter", shiftKey });
// The line of the match the search is at, as the list marks it.
const marked = () =>
  rows()
    .filter((element) => element.getAttribute("aria-current") === "true")
    .map((element) => Number(element.dataset.textLine));
const levels = () =>
  Object.fromEntries(
    ["error", "warning", "info", "debug", "other"].map((name) => [
      name,
      [level(name).textContent, level(name).dataset.count, level(name).getAttribute("aria-pressed")],
    ]),
  );
// The lines that are in the room of the list, without the ones kept ready around them.
function inRoom(): number[] {
  const top = scroller().scrollTop;

  return rows()
    .filter((element) => {
      const from = Number.parseFloat(element.style.top);

      return from + Number.parseFloat(element.style.height) > top && from < top + virtualList.room;
    })
    .map((element) => Number(element.dataset.textLine));
}

function scroll(to: number): void {
  scroller().scrollTop = to;
  fireEvent.scroll(scroller());
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  virtualList.room = ROOM_OF_THE_TESTS;
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("the log of an operation", () => {
  it("shows the lines of a text log with their numbers, and how many are of each level", () => {
    render(<LogViewer id="log" text={TEXT} of="Backup" />);
    expect(screen.getByTestId("log").contains(list())).toBe(true);
    expect(numbers()).toEqual([1, 2, 3, 4, 5, 6]);
    expect([1, 2, 3, 4, 5, 6].map((number) => shown(number).textContent)).toEqual(TEXT.split("\n"));
    expect(rows().map((element) => element.querySelector("span")?.textContent)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect([list().getAttribute("role"), list().getAttribute("aria-label")]).toEqual(["list", "The lines of the log"]);
    // The level of a warning is written warning; a message that says level=error is of the level of its
    // entry; a line without a level is of none of the four.
    expect(levels()).toEqual({
      error: ["Error 1", "1", "false"],
      warning: ["Warning 1", "1", "false"],
      info: ["Info 2", "2", "false"],
      debug: ["Debug 1", "1", "false"],
      other: ["Other 1", "1", "false"],
    });
    expect(count()).toBe("6 lines");
  });

  it("reads the levels of a JSON log from the key of each entry", () => {
    render(
      <LogViewer
        id="log"
        text={[
          json("info", "Backing up item"),
          json("warning", "Volume skipped"),
          json("error", "Error backing up item"),
          json("info", 'the entry before said "level":"error"'),
          json("debug", "Skipping action"),
          "{}",
          json("trace", "a level the filter has no name for"),
        ].join("\n")}
        of="Restore"
      />,
    );
    expect(numbers()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(shown(2).textContent).toBe(json("warning", "Volume skipped"));
    expect(levels()).toEqual({
      error: ["Error 1", "1", "false"],
      warning: ["Warning 1", "1", "false"],
      info: ["Info 2", "2", "false"],
      debug: ["Debug 1", "1", "false"],
      other: ["Other 2", "2", "false"],
    });
  });

  it("marks its first line as what is given the focus when the text arrives", () => {
    render(<LogViewer id="log" text={TEXT} of="Backup" />);
    expect([...document.querySelectorAll(`[${CONTENT}]`)]).toEqual([row(1)]);
    expect(row(1).tabIndex).toBe(-1);
  });

  it("says that a log has no line", () => {
    render(<LogViewer id="log" text="" of="Backup" />);
    expect(screen.getByTestId("log-none").textContent).toBe("The log has no line.");
    expect([...document.querySelectorAll(`[${CONTENT}]`)]).toEqual([screen.getByTestId("log-none")]);
    expect(count()).toBe("0 lines");
  });
});

describe("the filter by level", () => {
  it("hides no line until a level is chosen, and then leaves the lines of the levels that are", () => {
    render(<LogViewer id="log" text={TEXT} of="Backup" />);
    const group = screen.getByTestId("log-levels");

    // The levels are a group with a name, and each is a control that says whether it is chosen.
    expect([group.tagName, group.querySelector("legend")?.textContent]).toEqual([
      "FIELDSET",
      "Show only the lines of these levels",
    ]);
    // What the choices do is said to who sees them as well, in two words before the first of them: the
    // name of the group says it whole to who does not, and these words are not said twice.
    expect(
      [...group.children].map((part) => [part.tagName, part.getAttribute("aria-hidden"), part.textContent]),
    ).toEqual([
      ["LEGEND", null, "Show only the lines of these levels"],
      ["SPAN", "true", "Show only"],
      ["BUTTON", null, "Error 1"],
      ["BUTTON", null, "Warning 1"],
      ["BUTTON", null, "Info 2"],
      ["BUTTON", null, "Debug 1"],
      ["BUTTON", null, "Other 1"],
    ]);
    expect([...group.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "Error 1",
      "Warning 1",
      "Info 2",
      "Debug 1",
      "Other 1",
    ]);
    // Each choice is a command the Tab key reaches.
    expect([...group.querySelectorAll("button")].map((button) => button.tabIndex)).toEqual([0, 0, 0, 0, 0]);
    expect(numbers()).toEqual([1, 2, 3, 4, 5, 6]);
    fireEvent.click(level("warning"));
    expect([level("warning").getAttribute("aria-pressed"), level("error").getAttribute("aria-pressed")]).toEqual([
      "true",
      "false",
    ]);
    // A line keeps the number it has in the log.
    expect(numbers()).toEqual([3]);
    expect(count()).toBe("1 of 6 lines");
    // The first line that is left is the first of what is shown: it is the one marked to be given the focus.
    expect([...document.querySelectorAll(`[${CONTENT}]`)]).toEqual([row(3)]);
    expect([row(3).getAttribute("aria-posinset"), row(3).getAttribute("aria-setsize")]).toEqual(["1", "1"]);
    fireEvent.click(level("error"));
    fireEvent.click(level("other"));
    expect(numbers()).toEqual([2, 3, 6]);
    expect(count()).toBe("3 of 6 lines");
    // The counts are the ones of the log, whatever is chosen.
    expect(levels().info).toEqual(["Info 2", "2", "false"]);
    fireEvent.click(level("warning"));
    expect(numbers()).toEqual([2, 6]);
    fireEvent.click(level("error"));
    fireEvent.click(level("other"));
    expect(numbers()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(count()).toBe("6 lines");
  });

  it("copies the line of the row whose command is given, whatever its place among the lines that are left", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    const lines = TEXT.split("\n");

    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<LogViewer id="log" text={TEXT} of="Backup" />);
    fireEvent.click(level("warning"));
    fireEvent.click(level("other"));
    expect(numbers()).toEqual([3, 6]);
    await act(async () => {
      fireEvent.click(screen.getByTestId("log-line-6-copy"));
    });
    expect(writeText.mock.calls).toEqual([[lines[5]]]);
    expect(screen.getByTestId("log-copied").textContent).toBe(`Line 6 is copied whole: ${lines[5].length} characters.`);
    await act(async () => {
      fireEvent.click(screen.getByTestId("log-line-3-copy"));
    });
    expect(writeText.mock.calls[1]).toEqual([lines[2]]);
  });

  it("says that no line is of the levels that are chosen, in words that are given the focus", () => {
    render(<LogViewer id="log" text={[entry("info", "one"), entry("info", "two")].join("\n")} of="Backup" />);
    fireEvent.click(level("error"));
    expect(screen.getByTestId("log-none").textContent).toBe("No line is of the levels that are chosen.");
    expect([...document.querySelectorAll(`[${CONTENT}]`)]).toEqual([screen.getByTestId("log-none")]);
    expect(count()).toBe("0 of 2 lines");
    fireEvent.click(level("error"));
    expect(numbers()).toEqual([1, 2]);
  });

  it("keeps the line that was first in the room there, or the next one that is left", () => {
    const text = Array.from({ length: 4_000 }, (_, index) =>
      entry(index % 4 === 0 ? "error" : "info", `item ${index + 1}`),
    ).join("\n");

    render(<LogViewer id="log" text={text} of="Backup" />);
    scroll(2_001 * LINE);
    expect(inRoom()[0]).toBe(2_002);
    // The errors are the lines 1, 5, 9 and so on: the first one from the line 2002 on is the 2005.
    fireEvent.click(level("error"));
    expect(inRoom()[0]).toBe(2_005);
    expect(scroller().scrollTop).toBe(501 * LINE);
    fireEvent.click(level("error"));
    expect(inRoom()[0]).toBe(2_005);
  });
});

describe("the search of the log", () => {
  it("is a labelled field, with what it found in a part that says it to who does not see", () => {
    render(<LogViewer id="log" text={TEXT} of="Backup" />);
    const label = document.getElementById(field().getAttribute("aria-labelledby") ?? "");

    expect(label?.textContent).toBe("Search the log");
    expect(screen.getByTestId("log-search-status").getAttribute("role")).toBe("status");
    expect(screen.getByTestId("log-count").getAttribute("role")).toBe("status");
    // Nothing is searched, and nothing is said, until a word is typed.
    expect([status(), marked()]).toEqual(["", []]);
    for (const command of ["log-search-previous", "log-search-next"])
      expect((screen.getByTestId(command) as HTMLButtonElement).disabled).toBe(true);
    expect([
      screen.getByTestId("log-search-previous").getAttribute("aria-label"),
      screen.getByTestId("log-search-next").getAttribute("aria-label"),
    ]).toEqual(["Previous match", "Next match"]);
  });

  it("keeps Escape for itself, as the search of the host does: it clears what was typed, and the key goes no further", () => {
    const heard: string[] = [];

    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: what holds the viewer, which listens to the keys as the workspace of the view does
      <div onKeyDown={(event) => heard.push(event.key)}>
        <LogViewer id="log" text={TEXT} of="Backup" />
      </div>,
    );
    type("backing");
    expect(status()).toBe("Match 1 of 3, on line 1.");
    fireEvent.keyDown(field(), { key: "Escape" });
    expect([field().value, status(), marked()]).toEqual(["", "", []]);
    expect(heard).toEqual([]);
    // With nothing typed the key is still of the field: the view is not left from inside it.
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(heard).toEqual([]);
    // The other keys of the field, and Escape anywhere else in the viewer, are heard by what holds it.
    fireEvent.keyDown(field(), { key: "a" });
    fireEvent.keyDown(level("error"), { key: "Escape" });
    fireEvent.keyDown(row(1), { key: "Escape" });
    expect(heard).toEqual(["a", "Escape", "Escape"]);
  });

  it("finds the lines that carry the words, whatever their capitals, counts them and marks the one it is at", () => {
    render(<LogViewer id="log" text={TEXT} of="Backup" />);
    type("backing");
    // One match is one line: the second line says it twice, in its own capitals.
    expect([status(), marked()]).toEqual(["Match 1 of 3, on line 1.", [1]]);
    expect((screen.getByTestId("log-search-next") as HTMLButtonElement).disabled).toBe(false);
    type("BACKING UP ITEM");
    expect([status(), marked()]).toEqual(["Match 1 of 2, on line 1.", [1]]);
    type("level=error");
    expect([status(), marked()]).toEqual(["Match 1 of 2, on line 2.", [2]]);
    // No line is hidden by a search.
    expect(numbers()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("marks the words it found in every row that carries them, each as it is written, and in no other row", () => {
    render(<LogViewer id="log" text={TEXT} of="Backup" />);
    // The words that are marked in the row of a line, in their order.
    const found = (number: number) => [...shown(number).querySelectorAll("mark")].map((mark) => mark.textContent);

    expect(numbers().map(found)).toEqual([[], [], [], [], [], []]);
    type("backing");
    // The lines that carry the words have them marked, in the capitals each line writes them in: the row
    // of the match the search is at, and the rows of the other matches as well.
    expect(numbers().map(found)).toEqual([["Backing"], ["backing"], [], [], ["BACKING"], []]);
    expect(marked()).toEqual([1]);
    // What a row shows of its line is the line, with the marks or without them.
    expect(shown(1).textContent).toBe(TEXT.split("\n")[0]);
    expect(shown(5).textContent).toBe(TEXT.split("\n")[4]);
    // Words a line carries more than once are marked at each place.
    type("up");
    expect(found(1)).toEqual(["up", "up", "up", "up"]);
    type("no such words");
    expect(numbers().map(found)).toEqual([[], [], [], [], [], []]);
    type("");
    expect(numbers().map(found)).toEqual([[], [], [], [], [], []]);
  });

  it("says in words that no line carries the words", () => {
    render(<LogViewer id="log" text={TEXT} of="Backup" />);
    type("no such words");
    expect([status(), marked()]).toEqual(["No line carries these words.", []]);
    for (const command of ["log-search-previous", "log-search-next"])
      expect((screen.getByTestId(command) as HTMLButtonElement).disabled).toBe(true);
    // Enter goes nowhere then: the list is at the line it was at, whose command the Tab key still reaches.
    const reached = () => numbers().filter((number) => screen.getByTestId(`log-line-${number}-copy`).tabIndex === 0);

    row(4).focus();
    expect(reached()).toEqual([4]);
    enter();
    enter(true);
    expect([status(), marked()]).toEqual(["No line carries these words.", []]);
    expect(reached()).toEqual([4]);
    type("");
    expect([status(), marked()]).toEqual(["", []]);
  });

  it("goes to the next match and to the one before with Enter and Shift with Enter, around the ends", () => {
    render(<LogViewer id="log" text={TEXT} of="Backup" />);
    type("backing");
    enter();
    expect([status(), marked()]).toEqual(["Match 2 of 3, on line 2.", [2]]);
    enter();
    expect([status(), marked()]).toEqual(["Match 3 of 3, on line 5.", [5]]);
    // After the last is the first, and before the first is the last.
    enter();
    expect([status(), marked()]).toEqual(["Match 1 of 3, on line 1.", [1]]);
    enter(true);
    expect([status(), marked()]).toEqual(["Match 3 of 3, on line 5.", [5]]);
    enter(true);
    expect([status(), marked()]).toEqual(["Match 2 of 3, on line 2.", [2]]);
    // Another key of the field moves nothing.
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "a" });
    expect(marked()).toEqual([2]);
    // Enter is taken by the search, with Shift and without: nothing else is done with the key. The other
    // keys of the field are left as they are.
    expect([enter(), enter(true)]).toEqual([false, false]);
    expect(marked()).toEqual([2]);
    expect([fireEvent.keyDown(field(), { key: "a" }), fireEvent.keyDown(field(), { key: "ArrowDown" })]).toEqual([
      true,
      true,
    ]);
  });

  it("goes to the next match and to the one before with its commands, around the ends", () => {
    render(<LogViewer id="log" text={TEXT} of="Backup" />);
    type("backing");
    fireEvent.click(screen.getByTestId("log-search-previous"));
    expect([status(), marked()]).toEqual(["Match 3 of 3, on line 5.", [5]]);
    fireEvent.click(screen.getByTestId("log-search-next"));
    expect([status(), marked()]).toEqual(["Match 1 of 3, on line 1.", [1]]);
    fireEvent.click(screen.getByTestId("log-search-next"));
    expect([status(), marked()]).toEqual(["Match 2 of 3, on line 2.", [2]]);
  });

  it("works among the lines the filter leaves, and its count follows", () => {
    render(<LogViewer id="log" text={TEXT} of="Backup" />);
    type("backing");
    enter();
    expect([status(), marked()]).toEqual(["Match 2 of 3, on line 2.", [2]]);
    // The match it is at stays the one of its line while that line is left.
    fireEvent.click(level("error"));
    expect([status(), marked(), numbers()]).toEqual(["Match 1 of 1, on line 2.", [2], [2]]);
    enter();
    expect([status(), marked()]).toEqual(["Match 1 of 1, on line 2.", [2]]);
    fireEvent.click(level("info"));
    expect([status(), marked(), numbers()]).toEqual(["Match 2 of 3, on line 2.", [2], [1, 2, 5]]);
    // Its line is hidden: the search is at its first match.
    fireEvent.click(level("error"));
    expect([status(), marked(), numbers()]).toEqual(["Match 1 of 2, on line 1.", [1], [1, 5]]);
    fireEvent.click(level("info"));
    fireEvent.click(level("debug"));
    expect([status(), marked(), numbers()]).toEqual([
      "No line of the levels that are chosen carries these words.",
      [],
      [4],
    ]);
  });

  it("writes as attributes what its words say in numbers: the words that are searched with their matches, the match the search is at and its line, and the lines a filter leaves of the log", () => {
    render(<LogViewer id="log" text={TEXT} of="Backup" />);
    const written = () => {
      const search = screen.getByTestId("log-search-status");
      const lines = screen.getByTestId("log-count");

      return [
        ...["data-words", "data-matches", "data-match", "data-line"].map((name) => search.getAttribute(name)),
        ...["data-shown", "data-lines"].map((name) => lines.getAttribute(name)),
      ];
    };

    // No search: no match, which is the place before the first, and the line of none. No line is hidden.
    expect(written()).toEqual(["", "0", "-1", null, "6", "6"]);
    type("backing");
    expect([status(), written()]).toEqual(["Match 1 of 3, on line 1.", ["backing", "3", "0", "1", "6", "6"]]);
    enter();
    enter();
    // The match is counted from zero, and its line from one, as its row is.
    expect([status(), written()]).toEqual(["Match 3 of 3, on line 5.", ["backing", "3", "2", "5", "6", "6"]]);
    fireEvent.click(level("error"));
    expect([status(), count(), written()]).toEqual([
      "Match 1 of 1, on line 2.",
      "1 of 6 lines",
      ["backing", "1", "0", "2", "1", "6"],
    ]);
    type("no such words");
    expect(written()).toEqual(["no such words", "0", "-1", null, "1", "6"]);
  });

  it("brings the match it is at into the room of the list, and puts the list at it", () => {
    const text = Array.from({ length: 5_000 }, (_, index) =>
      entry("info", [999, 2_999, 4_499].includes(index) ? `the needle of line ${index + 1}` : `item ${index + 1}`),
    ).join("\n");

    render(<LogViewer id="log" text={text} of="Backup" />);
    expect(numbers().includes(1_000)).toBe(false);
    type("NEEDLE");
    expect([status(), marked(), inRoom().includes(1_000)]).toEqual(["Match 1 of 3, on line 1000.", [1_000], true]);
    // The command of the line the list is at is the one the Tab key reaches, and the field keeps the focus.
    field().focus();
    enter();
    expect([status(), marked(), inRoom().includes(3_000)]).toEqual(["Match 2 of 3, on line 3000.", [3_000], true]);
    expect(screen.getByTestId("log-line-3000-copy").tabIndex).toBe(0);
    expect(document.activeElement).toBe(field());
    enter(true);
    enter(true);
    expect([status(), marked(), inRoom().includes(4_500)]).toEqual(["Match 3 of 3, on line 4500.", [4_500], true]);
    // A match that was scrolled away from is brought back when the search is asked again.
    scroll(0);
    expect(marked()).toEqual([]);
    fireEvent.click(screen.getByTestId("log-search-next"));
    expect([status(), marked(), inRoom().includes(1_000)]).toEqual(["Match 1 of 3, on line 1000.", [1_000], true]);
  });

  it("brings its only match back into the room when it is asked for again", () => {
    const text = Array.from({ length: 3_000 }, (_, index) =>
      entry("info", index === 1_999 ? "the only needle" : `item ${index + 1}`),
    ).join("\n");

    render(<LogViewer id="log" text={text} of="Backup" />);
    type("needle");
    expect([status(), inRoom().includes(2_000)]).toEqual(["Match 1 of 1, on line 2000.", true]);
    for (const again of [
      () => enter(),
      () => enter(true),
      () => fireEvent.click(screen.getByTestId("log-search-next")),
    ]) {
      scroll(0);
      expect(inRoom().includes(2_000)).toBe(false);
      again();
      expect([status(), marked(), inRoom().includes(2_000)]).toEqual(["Match 1 of 1, on line 2000.", [2_000], true]);
    }
    // And when what is found changes around it, by other words or by a level, while its line does not.
    for (const changed of [() => type("only needle"), () => fireEvent.click(level("info"))]) {
      scroll(0);
      expect(inRoom().includes(2_000)).toBe(false);
      changed();
      expect([status(), marked(), inRoom().includes(2_000)]).toEqual(["Match 1 of 1, on line 2000.", [2_000], true]);
    }
  });

  it("says what it found in the words of one place", () => {
    expect(searchWords("", 0, -1, 0, false)).toBe("");
    expect(searchWords("", 0, -1, 0, true)).toBe("");
    expect(searchWords("a", 0, -1, 0, false)).toBe("No line carries these words.");
    expect(searchWords("a", 0, -1, 0, true)).toBe("No line of the levels that are chosen carries these words.");
    expect(searchWords("a", 1, 0, 0, false)).toBe("Match 1 of 1, on line 1.");
    expect(searchWords("a", 120, 2, 4_511, true)).toBe("Match 3 of 120, on line 4512.");
  });
});

describe("a line of twenty thousand characters in a log", () => {
  const long = entry("error", "y".repeat(20_000));

  it("is cut in its row, counted at its level, found by the search, and whole in its copy", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);

    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(
      <LogViewer id="log" text={[entry("info", "before"), long, entry("info", "after")].join("\n")} of="Backup" />,
    );
    expect(shown(2).querySelector("span")?.textContent).toBe(long.slice(0, LINE_BOUND));
    expect(screen.getByTestId("log-line-2-cut").textContent).toBe(
      `${long.length - LINE_BOUND} more characters of this line are not shown: the copy of the line takes it whole.`,
    );
    expect(levels().error).toEqual(["Error 1", "1", "false"]);
    // What ends the line is past what its row shows of it: the search looks through the whole line.
    type('yy" backup=velero/nightly');
    expect([status(), marked()]).toEqual(["Match 1 of 1, on line 2.", [2]]);
    await act(async () => {
      fireEvent.click(screen.getByTestId("log-line-2-copy"));
    });
    expect(writeText.mock.calls).toEqual([[long]]);
    expect(screen.getByTestId("log-copied").textContent).toBe(`Line 2 is copied whole: ${long.length} characters.`);
  });
});

describe("a line that takes more than one row, among the lines a filter leaves", () => {
  it("is as tall as it is, wherever its place is among them, and so is each of the others", () => {
    const long = entry("error", "y".repeat(20_000));

    render(
      <LogViewer
        id="log"
        text={[entry("info", "before"), long, entry("info", "after"), entry("error", "short")].join("\n")}
        of="Backup"
      />,
    );
    expect([1, 2, 3, 4].map((number) => row(number).style.height)).toEqual(["20px", "40px", "20px", "20px"]);
    fireEvent.click(level("error"));
    expect(numbers()).toEqual([2, 4]);
    // The line that is cut is the first that is left: its row is the one that is a line taller.
    expect([2, 4].map((number) => [row(number).style.top, row(number).style.height])).toEqual([
      ["0px", "40px"],
      ["40px", "20px"],
    ]);
  });
});

describe("a log of two hundred thousand lines", () => {
  const large = Array.from({ length: 200_000 }, (_, index) =>
    entry(
      index % 97 === 0 ? "error" : index % 13 === 0 ? "warning" : index % 5 === 0 ? "debug" : "info",
      `Backed up item ${index + 1} of the namespace`,
      `backup=velero/large name=item-${index + 1} logSource="pkg/backup/item_backupper.go:${index % 900}"`,
    ),
  ).join("\n");

  it("has a hundred rows mounted at most, whatever is searched, filtered and scrolled to", () => {
    render(<LogViewer id="log" text={large} of="Backup" />);
    expect(list().style.maxHeight).toBe(`${ROOM}px`);
    virtualList.room = Number.parseFloat(list().style.maxHeight);
    const within = () => [numbers().length <= ROWS_BOUND, numbers().length > 70];

    scroll(100_000 * LINE + 3);
    expect([numbers().length, inRoom()[0]]).toEqual([99, 100_001]);
    type("name=item-150000 ");
    expect([status(), marked(), within()]).toEqual(["Match 1 of 1, on line 150000.", [150_000], [true, true]]);
    type("backed up item");
    expect([status(), within()]).toEqual(["Match 1 of 200000, on line 1.", [true, true]]);
    fireEvent.click(screen.getByTestId("log-search-previous"));
    expect([status(), marked(), within()]).toEqual([
      "Match 200000 of 200000, on line 200000.",
      [200_000],
      [true, true],
    ]);
    fireEvent.click(level("warning"));
    expect(count()).toBe(`${parseLog(large).counts.warning} of 200000 lines`);
    expect(within()).toEqual([true, true]);
    scroll(5_000 * LINE);
    expect(within()).toEqual([true, true]);
    fireEvent.click(screen.getByTestId("log-wrap"));
    expect(within()).toEqual([true, true]);
  });

  it("is read once, and searched once for the words and the levels that are asked", () => {
    render(<LogViewer id="log" text={large} of="Backup" />);
    expect([vi.mocked(parseLog).mock.calls.length, vi.mocked(searchLog).mock.calls.length]).toEqual([1, 1]);
    // The text that was read is the one that was given, and it is what the lines are made of.
    expect(vi.mocked(parseLog).mock.results[0].value.text).toBe(large);
    // The line 19999, and the ten from the 199990 on.
    type("item-19999");
    expect(status()).toBe("Match 1 of 11, on line 19999.");
    expect(vi.mocked(searchLog).mock.calls.length).toBe(2);
    // Moving among the matches reads nothing and searches nothing again: twelve times to the next, around
    // the end, and twice to the one before, around the start.
    for (let turn = 0; turn < 14; turn += 1) fireEvent.keyDown(field(), { key: "Enter", shiftKey: turn > 11 });
    expect(status()).toBe("Match 11 of 11, on line 199999.");
    fireEvent.click(screen.getByTestId("log-search-next"));
    fireEvent.click(screen.getByTestId("log-search-previous"));
    fireEvent.click(screen.getByTestId("log-wrap"));
    scroll(40_000 * LINE);
    expect([
      vi.mocked(parseLog).mock.calls.length,
      vi.mocked(searchLog).mock.calls.length,
      vi.mocked(shownLines).mock.calls.length,
    ]).toEqual([1, 2, 1]);
    // A change of the filter looks for the lines it leaves and for the matches among them, once, and
    // does not read the text again.
    fireEvent.click(level("error"));
    fireEvent.click(level("warning"));
    expect([
      vi.mocked(parseLog).mock.calls.length,
      vi.mocked(searchLog).mock.calls.length,
      vi.mocked(shownLines).mock.calls.length,
    ]).toEqual([1, 4, 3]);
  });

  it("makes a line of the text for a row that is mounted, and for no other", () => {
    const whole = vi.spyOn(String.prototype, "split");
    const lower = vi.spyOn(String.prototype, "toLowerCase");
    const upper = vi.spyOn(String.prototype, "toUpperCase");
    // The copies of the whole text that were made by one of the ways a text is copied in.
    const copies = () =>
      [whole, lower, upper].flatMap((spy) => spy.mock.contexts).filter((text) => String(text).length >= 1_000_000);

    try {
      render(<LogViewer id="log" text={large} of="Backup" />);
      // Each step makes the lines of the rows it draws, which are a hundred at most each time it draws.
      const step = (act: () => void, draws: number) => {
        const before = vi.mocked(logLine).mock.calls.length;

        act();
        const made = vi.mocked(logLine).mock.calls.length - before;

        expect([made > 0, made <= draws * ROWS_BOUND]).toEqual([true, true]);
      };

      expect(vi.mocked(logLine).mock.calls.length).toBe(numbers().length);
      step(() => type("backed up item"), 2);
      expect(status()).toBe("Match 1 of 200000, on line 1.");
      step(() => enter(), 2);
      step(() => fireEvent.click(level("info")), 3);
      step(() => scroll(60_000 * LINE), 1);
      step(() => fireEvent.click(screen.getByTestId("log-wrap")), 2);
      expect(copies()).toEqual([]);
    } finally {
      whole.mockRestore();
      lower.mockRestore();
      upper.mockRestore();
    }
  });
});
