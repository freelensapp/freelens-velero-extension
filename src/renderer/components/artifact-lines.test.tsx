// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { virtualList } from "../../../test/host-components";
import { LINE_BOUND, parseLog, textLines } from "../../common/artifact-log";
import { ArtifactLines, LINE, LineList, linesWords, ROOM, ROWS_BOUND } from "./artifact-lines";
import { CONTENT } from "./artifact-viewer";

// The function that reads a text as a log is the one of the log, and its calls are counted.
vi.mock("../../common/artifact-log", async (original) => {
  const log = await original<typeof import("../../common/artifact-log")>();

  return { ...log, parseLog: vi.fn(log.parseLog) };
});

const ROOM_OF_THE_TESTS = virtualList.room;

const list = () => screen.getByTestId("lines-text");
const scroller = () => list().querySelector<HTMLElement>(".list") as HTMLElement;
const rows = () => [...list().querySelectorAll<HTMLElement>("[data-text-line]")];
const numbers = () => rows().map((row) => Number(row.dataset.textLine));
const row = (number: number) => screen.getByTestId(`lines-line-${number}`);
const shown = (number: number) => screen.getByTestId(`lines-line-${number}-text`);
const focused = () => document.activeElement as HTMLElement;
const press = (key: string, more: object = {}) => fireEvent.keyDown(focused(), { key, ...more });

// The list is scrolled as the operator scrolls it: by its element.
function scroll(to: number): void {
  scroller().scrollTop = to;
  fireEvent.scroll(scroller());
}

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

// The room a list measures: its width, the width of a character, and what a row has before its text. The
// observers of the room are kept, to be told that it changed.
const observers: (() => void)[] = [];

function measure(room: { width: number; character: number; before: number }): void {
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this.classList.contains("list") ? room.width : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(() => room.before);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return { width: (this.textContent ?? "").length * room.character } as DOMRect;
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly changed: () => void) {}

      observe(): void {
        observers.push(this.changed);
      }

      disconnect(): void {
        observers.splice(observers.indexOf(this.changed), 1);
      }
    },
  );
}

function clipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  observers.length = 0;
  virtualList.room = ROOM_OF_THE_TESTS;
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("a text shown as its lines", () => {
  it("shows the lines with their numbers under the note, as a list that has a name, and reads no level", () => {
    render(
      <ArtifactLines
        id="lines"
        text={'{"level":"error","msg":"no entry of a log"}\nsecond\n\nfourth'}
        note="The shape of this file is not the one the extension was written for: it is shown as text."
      />,
    );
    expect(screen.getByTestId("lines").contains(list())).toBe(true);
    expect(screen.getByTestId("lines-note").textContent).toBe(
      "The shape of this file is not the one the extension was written for: it is shown as text.",
    );
    expect(numbers()).toEqual([1, 2, 3, 4]);
    expect([1, 2, 3, 4].map((number) => shown(number).textContent)).toEqual([
      '{"level":"error","msg":"no entry of a log"}',
      "second",
      "",
      "fourth",
    ]);
    expect(rows().map((element) => element.querySelector("span")?.textContent)).toEqual(["1", "2", "3", "4"]);
    expect([list().getAttribute("role"), list().getAttribute("aria-label")]).toEqual(["list", "The lines of the text"]);
    expect(
      rows().map((element) => [
        element.getAttribute("role"),
        element.getAttribute("aria-posinset"),
        element.getAttribute("aria-setsize"),
      ]),
    ).toEqual([
      ["listitem", "1", "4"],
      ["listitem", "2", "4"],
      ["listitem", "3", "4"],
      ["listitem", "4", "4"],
    ]);
    expect(screen.getByTestId("lines-count").textContent).toBe("4 lines");
    // It is the list alone: the levels and the search are of the log, and the text is not read as one.
    expect(screen.queryByTestId("lines-levels")).toBeNull();
    expect(screen.queryByTestId("lines-search")).toBeNull();
    expect(vi.mocked(parseLog)).not.toHaveBeenCalled();
  });

  it("has no note when it is given none", () => {
    render(<ArtifactLines id="lines" text="one" />);
    expect(screen.queryByTestId("lines-note")).toBeNull();
    expect(screen.getByTestId("lines-count").textContent).toBe("1 line");
  });

  it("marks its first line as what is given the focus when the text arrives, outside the order of the Tab key", () => {
    render(<ArtifactLines id="lines" text={"first\nsecond\nthird"} />);
    const marked = [...document.querySelectorAll<HTMLElement>(`[${CONTENT}]`)];

    expect(marked).toEqual([row(1)]);
    expect(marked[0].tabIndex).toBe(-1);
    marked[0].focus();
    expect(focused()).toBe(row(1));
  });

  it("says that a file has no line, in words that are given the focus", () => {
    render(<ArtifactLines id="lines" text="" />);
    const marked = [...document.querySelectorAll<HTMLElement>(`[${CONTENT}]`)];

    expect(marked).toEqual([screen.getByTestId("lines-none")]);
    expect(marked[0].textContent).toBe("The file has no line.");
    expect(marked[0].tabIndex).toBe(-1);
    expect(screen.queryByTestId("lines-text")).toBeNull();
    expect(screen.getByTestId("lines-count").textContent).toBe("0 lines");
  });

  it("begins another text at its first line, which is the one that is given the focus", () => {
    const text = (name: string) => Array.from({ length: 900 }, (_, index) => `${name} ${index + 1}`).join("\n");
    const view = render(<ArtifactLines id="lines" text={text("first")} />);

    scroll(600 * LINE);
    row(601).focus();
    expect([numbers().includes(1), document.querySelector(`[${CONTENT}]`)]).toEqual([false, null]);
    view.rerender(<ArtifactLines id="lines" text={text("second")} />);
    expect([scroller().scrollTop, inRoom()[0], shown(1).textContent]).toEqual([0, 1, "second 1"]);
    expect([...document.querySelectorAll(`[${CONTENT}]`)]).toEqual([row(1)]);
    // The list is at the first line of the text it shows now.
    expect(screen.getByTestId("lines-line-1-copy").tabIndex).toBe(0);
    // The same text given again moves nothing.
    scroll(300 * LINE);
    view.rerender(<ArtifactLines id="lines" text={text("second")} />);
    expect(inRoom()[0]).toBe(301);
  });

  it("says how many lines are shown of how many", () => {
    expect([linesWords(0, 0), linesWords(1, 1), linesWords(7, 7), linesWords(0, 7), linesWords(1, 7)]).toEqual([
      "0 lines",
      "1 line",
      "7 lines",
      "0 of 7 lines",
      "1 of 7 lines",
    ]);
  });
});

describe("the rows a list mounts", () => {
  const large = Array.from({ length: 200_000 }, (_, index) => `line ${index + 1} of a large text`).join("\n");

  it("are a hundred at most, of a text of two hundred thousand lines, wherever the list is scrolled to", () => {
    render(<ArtifactLines id="lines" text={large} />);
    // The tallest room a list is given is the one it sets for itself, whatever the window.
    expect(list().style.maxHeight).toBe(`${ROOM}px`);
    virtualList.room = Number.parseFloat(list().style.maxHeight);
    expect(ROWS_BOUND).toBe(100);
    for (const to of [0, 7, 20 * LINE, 1_000_010, 2_500_000 - 3, 200_000 * LINE - virtualList.room, 200_000 * LINE]) {
      scroll(to);
      const mounted = numbers();

      expect([to, mounted.length <= ROWS_BOUND, mounted.length > 70]).toEqual([to, true, true]);
      // They are the lines of that place, in their order, each on its own row.
      expect([to, inRoom()[0]]).toEqual([to, Math.floor(scroller().scrollTop / LINE) + 1]);
      expect(mounted).toEqual(mounted.map((_, index) => mounted[0] + index));
      for (const number of [mounted[0], mounted[mounted.length - 1]])
        expect(shown(number).textContent).toBe(`line ${number} of a large text`);
    }
    // In the middle of the text the room is full, with the rows kept ready on both sides.
    scroll(1_000_010);
    expect(numbers().length).toBe(99);
    expect(numbers()[0]).toBe(50_001 - 10);
    expect(list().dataset.rows).toBe("200000");
  });

  it("says how many lines are after the ones a list has the room of, when a text has more", () => {
    // A page places nothing further down than some thirty-three million pixels.
    render(<ArtifactLines id="lines" text={"\n".repeat(1_700_000)} />);
    expect(list().dataset.rows).toBe("1650000");
    expect(screen.getByTestId("lines-left").textContent).toContain(
      "The list has the room of 1650000 lines: 50000 lines after them are not in it. The file that is saved has every line.",
    );
    expect(screen.getByTestId("lines-left").getAttribute("role")).toBe("status");
    // The mark beside the words is not read with them: the host draws it as the text of its name.
    expect(screen.getByTestId("lines-left").querySelector(".Icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("lines-left").querySelector("span")?.textContent).toMatch(/^The list has the room of/);
    expect(screen.getByTestId("lines-count").textContent).toBe("1700000 lines");
    scroll(1_650_000 * LINE);
    expect(numbers()[numbers().length - 1]).toBe(1_650_000);
    expect(numbers().length).toBeLessThanOrEqual(ROWS_BOUND);
  });

  it("says of one line that it is left out, as of many", () => {
    // At a ratio of a thousand a page places a thousand times less far: the room of 1650 lines.
    vi.stubGlobal("devicePixelRatio", 1_000);
    render(<ArtifactLines id="lines" text={"\n".repeat(1_651)} />);
    expect(list().dataset.rows).toBe("1650");
    expect(screen.getByTestId("lines-left").querySelector("span")?.textContent).toBe(
      "The list has the room of 1650 lines: 1 line after them is not in it. The file that is saved has every line.",
    );
  });

  it("says nothing of the room of a list that has it for every line", () => {
    render(<ArtifactLines id="lines" text={"one\ntwo"} />);
    expect(screen.queryByTestId("lines-left")).toBeNull();
  });

  it("has the room a page has in its own pixels, which are fewer at twice the zoom and on a display of twice the scale", () => {
    // The browser places what it lays out in pixels of the layout, of which a pixel of the page is as
    // many as the zoom and the scale of the display make it: at a ratio of two a page places half as far.
    vi.stubGlobal("devicePixelRatio", 2);
    render(<ArtifactLines id="lines" text={"\n".repeat(1_700_000)} />);
    expect(list().dataset.rows).toBe("825000");
    expect(screen.getByTestId("lines-left").textContent).toContain(
      "The list has the room of 825000 lines: 875000 lines after them are not in it. The file that is saved has every line.",
    );
    scroll(825_000 * LINE);
    expect(numbers().at(-1)).toBe(825_000);
    // The zoom is taken back, which the window says as a change of its size: the list has its room again.
    vi.stubGlobal("devicePixelRatio", 1);
    fireEvent(window, new Event("resize"));
    expect(list().dataset.rows).toBe("1650000");
    expect(screen.getByTestId("lines-left").textContent).toContain("50000 lines after them are not in it");
    // A ratio under one gives no room a page does not have at one.
    vi.stubGlobal("devicePixelRatio", 0.5);
    fireEvent(window, new Event("resize"));
    expect(list().dataset.rows).toBe("1650000");
  });

  it("follows a display of another scale, which the window says without a change of its size", () => {
    const listeners: (() => void)[] = [];
    const asked: string[] = [];

    vi.stubGlobal("matchMedia", (query: string) => {
      asked.push(query);
      return {
        addEventListener: (_name: string, listener: () => void) => listeners.push(listener),
        removeEventListener: (_name: string, listener: () => void) => listeners.splice(listeners.indexOf(listener), 1),
      };
    });
    render(<ArtifactLines id="lines" text={"\n".repeat(1_700_000)} />);
    expect(list().dataset.rows).toBe("1650000");
    expect(asked).toEqual(["(resolution: 1dppx)"]);
    vi.stubGlobal("devicePixelRatio", 4);
    act(() => {
      for (const listener of [...listeners]) listener();
    });
    expect(list().dataset.rows).toBe("412500");
    // The ratio that is listened to is the one of now, and one listener is kept.
    expect(asked.at(-1)).toBe("(resolution: 4dppx)");
    expect(listeners).toHaveLength(1);
  });

  it("says that lines are left out of a wrapped list that a page at twice the zoom cannot place, and not only of one a page cannot at one", () => {
    // Two hundred thousand lines of two hundred and thirty-nine characters in a room of thirty columns:
    // eight rows a line, thirty-two million pixels, which a page places at a ratio of one and not at two.
    const text = Array.from({ length: 200_000 }, () => "x".repeat(239)).join("\n");

    vi.stubGlobal("devicePixelRatio", 2);
    measure({ width: 379, character: 9, before: 100 });
    render(<ArtifactLines id="lines" text={text} />);
    expect(screen.queryByTestId("lines-left")).toBeNull();
    fireEvent.click(screen.getByTestId("lines-wrap"));
    expect([list().dataset.columns, row(1).style.height]).toEqual(["30", "160px"]);
    expect(list().dataset.rows).toBe("103125");
    expect(screen.getByTestId("lines-left").textContent).toContain(
      "The list has the room of 103125 lines: 96875 lines after them are not in it.",
    );
    expect(screen.getByTestId("lines-count").textContent).toBe("200000 lines");
  });
});

describe("a line longer than a row shows", () => {
  const long = `time="2026-10-04T18:08:23Z" level=info msg="${"x".repeat(20_000)}"`;
  const text = `short\n${long}\nshort again`;

  it("is cut in its row, which says how much of it is left out and is one line taller for it", () => {
    render(<ArtifactLines id="lines" text={text} />);
    expect(long.length).toBeGreaterThan(20_000);
    expect(shown(2).querySelector("span")?.textContent).toBe(long.slice(0, LINE_BOUND));
    expect(screen.getByTestId("lines-line-2-cut").textContent).toBe(
      `${long.length - LINE_BOUND} more characters of this line are not shown: the copy of the line takes it whole.`,
    );
    expect(screen.queryByTestId("lines-line-1-cut")).toBeNull();
    expect([row(1).style.height, row(2).style.height, row(3).style.height]).toEqual(["20px", "40px", "20px"]);
    expect([row(1).style.top, row(2).style.top, row(3).style.top]).toEqual(["0px", "20px", "60px"]);
  });

  it("says of one character that it is left out, as of many", () => {
    render(<ArtifactLines id="lines" text={`${"z".repeat(LINE_BOUND + 1)}\n${"z".repeat(LINE_BOUND)}`} />);
    expect(screen.getByTestId("lines-line-1-cut").textContent).toBe(
      "1 more character of this line is not shown: the copy of the line takes it whole.",
    );
    expect(screen.queryByTestId("lines-line-2-cut")).toBeNull();
    expect([row(1).style.height, row(2).style.height]).toEqual(["40px", "20px"]);
  });

  it("is whole in its copy, which says that it was taken", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);

    clipboard(writeText);
    render(<ArtifactLines id="lines" text={text} />);
    const copy = screen.getByTestId("lines-line-2-copy");

    expect([copy.getAttribute("aria-label"), copy.getAttribute("title")]).toEqual(["Copy line 2", "Copy line 2"]);
    expect(screen.getByTestId("lines-copied").textContent).toBe("");
    expect(screen.getByTestId("lines-copied").getAttribute("role")).toBe("status");
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(writeText.mock.calls).toEqual([[long]]);
    expect(screen.getByTestId("lines-copied").textContent).toBe(`Line 2 is copied whole: ${long.length} characters.`);
    await act(async () => {
      fireEvent.click(screen.getByTestId("lines-line-1-copy"));
    });
    expect(writeText.mock.calls[1]).toEqual(["short"]);
    expect(screen.getByTestId("lines-copied").textContent).toBe("Line 1 is copied whole: 5 characters.");
  });

  it("says that a line could not be copied when the clipboard does not take it, or is not there", async () => {
    render(<ArtifactLines id="lines" text={text} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("lines-line-3-copy"));
    });
    expect(screen.getByTestId("lines-copied").textContent).toBe(
      "Line 3 could not be copied: the clipboard did not take it.",
    );
    clipboard(async () => {
      throw new Error("refused");
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("lines-line-1-copy"));
    });
    expect(screen.getByTestId("lines-copied").textContent).toBe(
      "Line 1 could not be copied: the clipboard did not take it.",
    );
  });
});

describe("the choice to wrap the lines", () => {
  const text = [
    "a".repeat(99),
    "b".repeat(250),
    "",
    "c".repeat(100),
    ...Array.from({ length: 3_000 }, (_, index) => `${index + 5} ${"d".repeat(120)}`),
  ].join("\n");
  const wrap = () => screen.getByTestId("lines-wrap");

  it("is not made until it is asked for: a line is one row, as long as it is", () => {
    measure({ width: 1_000, character: 9, before: 100 });
    render(<ArtifactLines id="lines" text={text} />);
    expect([wrap().getAttribute("aria-pressed"), wrap().textContent]).toEqual(["false", "Wrap the lines"]);
    // The choice says whether it is made as a checkbox does, and is a command the Tab key reaches.
    expect([wrap().tagName, wrap().tabIndex]).toEqual(["BUTTON", 0]);
    expect([list().dataset.wrap, list().dataset.columns]).toEqual(["false", undefined]);
    expect([1, 2, 3, 4].map((number) => shown(number).children.length)).toEqual([1, 1, 1, 1]);
    expect([1, 2, 3, 4].map((number) => row(number).style.height)).toEqual(["20px", "20px", "20px", "20px"]);
  });

  it("takes each line in pieces of the columns the room has, and each row as tall as its pieces", () => {
    // A room of a thousand pixels, a hundred of which are before the text of a row, and characters of
    // nine: a hundred columns, and one less.
    measure({ width: 1_000, character: 9, before: 100 });
    render(<ArtifactLines id="lines" text={text} />);
    fireEvent.click(wrap());
    expect(wrap().getAttribute("aria-pressed")).toBe("true");
    expect([list().dataset.wrap, list().dataset.columns]).toEqual(["true", "99"]);
    expect([...shown(2).children].map((piece) => piece.textContent)).toEqual([
      "b".repeat(99),
      "b".repeat(99),
      "b".repeat(52),
    ]);
    expect([1, 2, 3, 4].map((number) => shown(number).children.length)).toEqual([1, 3, 1, 2]);
    expect([1, 2, 3, 4, 5].map((number) => [row(number).style.top, row(number).style.height])).toEqual([
      ["0px", "20px"],
      ["20px", "60px"],
      ["80px", "20px"],
      ["100px", "40px"],
      ["140px", "40px"],
    ]);
    // The lines are whole in their pieces.
    expect(shown(2).textContent).toBe("b".repeat(250));
    // The choice is unmade: a line is one row again, and one piece in it, as long as it is.
    fireEvent.click(wrap());
    expect([wrap().getAttribute("aria-pressed"), row(2).style.height]).toEqual(["false", "20px"]);
    expect([list().dataset.wrap, list().dataset.columns]).toEqual(["false", undefined]);
    expect([1, 2, 3, 4].map((number) => shown(number).children.length)).toEqual([1, 1, 1, 1]);
    expect(shown(2).textContent).toBe("b".repeat(250));
  });

  it("keeps the line that was first in the room there, and mounts no more rows, when it is made and unmade", () => {
    measure({ width: 1_000, character: 9, before: 100 });
    render(<ArtifactLines id="lines" text={text} />);
    scroll(1_500 * LINE + 7);
    const before = numbers().length;

    expect(inRoom()[0]).toBe(1_501);
    fireEvent.click(wrap());
    // Every line before it is taller now: it is where they end, at the start of the room.
    expect(inRoom()[0]).toBe(1_501);
    expect(Number.parseFloat(row(1_501).style.top)).toBe(scroller().scrollTop);
    expect(scroller().scrollTop).toBe((1 + 3 + 1 + 2 + 1_496 * 2) * LINE);
    expect(numbers().length).toBeLessThan(before);
    expect(numbers().length).toBeLessThanOrEqual(ROWS_BOUND);
    scroll(scroller().scrollTop + 10 * 2 * LINE);
    expect(inRoom()[0]).toBe(1_511);
    fireEvent.click(wrap());
    expect(inRoom()[0]).toBe(1_511);
    expect(scroller().scrollTop).toBe(1_510 * LINE);
  });

  it("counts the columns again when the room changes, and keeps the place", () => {
    const room = { width: 1_000, character: 9, before: 100 };

    measure(room);
    render(<ArtifactLines id="lines" text={text} />);
    fireEvent.click(wrap());
    scroll((1 + 3 + 1 + 2 + 1_496 * 2) * LINE);
    expect([list().dataset.columns, inRoom()[0], observers.length]).toEqual(["99", 1_501, 1]);
    // Half the room: every line of a hundred and twenty characters and more is three pieces.
    room.width = 550;
    act(() => observers[0]());
    expect(list().dataset.columns).toBe("49");
    expect(shown(1_501).children.length).toBe(3);
    expect(inRoom()[0]).toBe(1_501);
    expect(Number.parseFloat(row(1_501).style.top)).toBe(scroller().scrollTop);
    // A room narrower than any line has the fewest columns a wrapped line is given.
    room.width = 120;
    act(() => observers[0]());
    expect(list().dataset.columns).toBe("20");
    fireEvent.click(wrap());
    expect(observers.length).toBe(0);
  });

  it("wraps the lines of a list the host draws after the choice was made, and follows its room from then", () => {
    const room = { width: 1_000, character: 9, before: 100 };

    measure(room);
    // A text with no line: the list of the host is not there, and the choice is made all the same.
    const view = render(<ArtifactLines id="lines" text="" />);

    fireEvent.click(wrap());
    expect(observers).toHaveLength(0);
    // The host draws the part its list scrolls a moment after the list itself: the room is measured when
    // that part arrives, and not only in the draw that asked for the list.
    view.rerender(<ArtifactLines id="lines" text={text} />);
    expect([wrap().getAttribute("aria-pressed"), list().dataset.wrap, list().dataset.columns]).toEqual([
      "true",
      "true",
      "99",
    ]);
    expect([shown(2).children.length, row(2).style.height]).toEqual([3, "60px"]);
    expect(observers).toHaveLength(1);
    // The room is followed from then on.
    room.width = 550;
    act(() => observers[0]());
    expect(list().dataset.columns).toBe("49");
    // The list goes and comes back, with the choice still made: its new room is the one that is followed.
    view.rerender(<ArtifactLines id="lines" text="" />);
    expect(observers).toHaveLength(0);
    room.width = 1_000;
    view.rerender(<ArtifactLines id="lines" text={text} />);
    expect([list().dataset.columns, row(2).style.height, observers.length]).toEqual(["99", "60px", 1]);
    room.width = 550;
    act(() => observers[0]());
    expect(list().dataset.columns).toBe("49");
  });

  it("takes the part the host scrolls out of the order of the Tab key: the list is the stop, and its keys are its own", () => {
    render(<ArtifactLines id="lines" text={text} />);
    // A part that scrolls and holds nothing the Tab key reaches would be a stop of its own, with no name.
    expect(scroller().getAttribute("tabindex")).toBe("-1");
    expect(list().tabIndex).toBe(0);
  });

  it("keeps what a cut line says of itself on one line of the room, and whole for who points at it", () => {
    const long = "e".repeat(LINE_BOUND + 300);
    const words = "300 more characters of this line are not shown: the copy of the line takes it whole.";

    measure({ width: 550, character: 9, before: 100 });
    render(<ArtifactLines id="lines" text={`${long}\nafter`} />);
    const cut = () => screen.getByTestId("lines-line-1-cut");

    // Not wrapped, it is as long as its words, as every line is.
    expect([cut().textContent, cut().title, cut().style.maxWidth]).toEqual([words, words, ""]);
    fireEvent.click(wrap());
    // Wrapped at forty-nine columns, the line is two hundred and five pieces, and what it says of itself
    // one row more, no wider than the columns.
    expect(list().dataset.columns).toBe("49");
    expect([cut().textContent, cut().title, cut().style.maxWidth]).toEqual([words, words, "49ch"]);
    expect([shown(1).children.length, row(1).style.height, row(2).style.top]).toEqual([
      206,
      `${206 * LINE}px`,
      `${206 * LINE}px`,
    ]);
  });

  it("wraps nothing while the room is not measured", () => {
    render(<ArtifactLines id="lines" text={text} />);
    fireEvent.click(wrap());
    expect([list().dataset.wrap, list().dataset.columns]).toEqual(["true", undefined]);
    expect([shown(2).children.length, row(2).style.height]).toEqual([1, "20px"]);
    cleanup();
    // The width of a character is known and the one of the room is not yet: no line is taken in pieces of
    // the fewest columns meanwhile, and the lines are wrapped when the room says its width.
    const room = { width: 0, character: 9, before: 100 };

    measure(room);
    render(<ArtifactLines id="lines" text={text} />);
    fireEvent.click(wrap());
    expect([list().dataset.wrap, list().dataset.columns]).toEqual(["true", undefined]);
    expect([shown(2).children.length, row(2).style.height]).toEqual([1, "20px"]);
    room.width = 1_000;
    act(() => observers[0]());
    expect([list().dataset.columns, shown(2).children.length, row(2).style.height]).toEqual(["99", 3, "60px"]);
  });
});

describe("the words a search is of, in the rows of a list", () => {
  // The words that are marked in the row of a line, in their order.
  const found = (number: number) => [...shown(number).querySelectorAll("mark")].map((mark) => mark.textContent);
  const lines = (text: string, wrap: boolean) => (
    <LineList id="lines" name="The lines" lines={textLines(text)} wrap={wrap} sought="needle" none="No line." />
  );

  it("are marked in each piece of a wrapped line that shows them, and in both when they go from a piece to the next", () => {
    // Ninety-nine columns: the first words begin four characters before the first piece ends, and the
    // second are whole in the piece after it.
    const line = `${"a".repeat(95)}needle${"b".repeat(50)}NEEDLE`;

    measure({ width: 1_000, character: 9, before: 100 });
    render(lines(`${line}\nno such words\na needle`, true));
    expect(list().dataset.columns).toBe("99");
    expect([...shown(1).children].map((piece) => piece.textContent)).toEqual([line.slice(0, 99), line.slice(99)]);
    expect(
      [...shown(1).children].map((piece) => [...piece.querySelectorAll("mark")].map((mark) => mark.textContent)),
    ).toEqual([["need"], ["le", "NEEDLE"]]);
    expect([found(2), found(3)]).toEqual([[], ["needle"]]);
    // The line is whole in its pieces, with the marks or without them.
    expect(shown(1).textContent).toBe(line);
  });

  it("are marked where a row shows them whole, and not where it cuts its line through them", () => {
    // The row shows the first ten thousand characters of its line, which end inside the words.
    const cut = `a needle, then ${"x".repeat(LINE_BOUND - 18)}needle and what is left of the line`;

    render(lines(`${cut}\na needle`, false));
    expect(shown(1).children[0].textContent).toBe(cut.slice(0, LINE_BOUND));
    expect(shown(1).children[0].textContent?.endsWith("xnee")).toBe(true);
    expect([found(1), found(2)]).toEqual([["needle"], ["needle"]]);
  });
});

describe("the keys of a list", () => {
  const text = Array.from({ length: 500 }, (_, index) => `line ${index + 1}`).join("\n");
  const reached = () =>
    rows()
      .filter((element) => element.querySelector("button")?.tabIndex === 0)
      .map((element) => Number(element.dataset.textLine));

  it("reach the list and the command of the line it is at, and no other command", () => {
    render(<ArtifactLines id="lines" text={text} />);
    expect(list().tabIndex).toBe(0);
    expect(reached()).toEqual([1]);
    expect(rows().every((element) => element.tabIndex === -1)).toBe(true);
    expect(screen.getByTestId("lines-line-2-copy").tabIndex).toBe(-1);
  });

  it("move the list among its lines, with the focus on the row it is at", () => {
    render(<ArtifactLines id="lines" text={text} />);
    list().focus();
    // The first key of a list the Tab key reached goes to the line the list is at.
    press("ArrowDown");
    expect(focused()).toBe(row(1));
    press("ArrowDown");
    press("ArrowDown");
    expect([focused(), reached()]).toEqual([row(3), [3]]);
    press("ArrowUp");
    expect(focused()).toBe(row(2));
    // A page is the rows of the room but one; here the room has no height, and a page is nine rows.
    press("PageDown");
    expect(focused()).toBe(row(11));
    press("PageUp");
    expect(focused()).toBe(row(2));
    press("End");
    expect([focused(), reached(), numbers().includes(500)]).toEqual([row(500), [500], true]);
    // There is no line after the last, and none before the first.
    press("ArrowDown");
    press("PageDown");
    expect(focused()).toBe(row(500));
    press("Home");
    expect([focused(), reached()]).toEqual([row(1), [1]]);
    press("ArrowUp");
    press("PageUp");
    expect(focused()).toBe(row(1));
    // Another key, and a key held with another, move nothing.
    press("a");
    press("ArrowDown", { ctrlKey: true });
    press("ArrowDown", { shiftKey: true });
    press("ArrowDown", { altKey: true });
    press("ArrowDown", { metaKey: true });
    expect(focused()).toBe(row(1));
    // A key of the list is taken by it: the page does nothing of its own with it, which would be to scroll
    // what holds the list. Another key, and a key held with another, are left to the page.
    for (const key of ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "End", "Home"])
      expect([key, press(key)]).toEqual([key, false]);
    for (const [key, held] of [
      ["a", {}],
      ["Tab", {}],
      ["Enter", {}],
      ["ArrowDown", { ctrlKey: true }],
      ["PageDown", { shiftKey: true }],
    ] as const)
      expect([key, press(key, held)]).toEqual([key, true]);
  });

  it("page by what the room shows when the lines are wrapped: no line is left between one room and the next", () => {
    // A room of twenty lines, and lines of two hundred and fifty characters in a room of ninety-nine
    // columns: each row is three lines tall, and the room shows six rows and a part of the seventh.
    const long = Array.from({ length: 200 }, (_, index) => `${index + 1} `.padEnd(250, "x")).join("\n");

    virtualList.room = 20 * LINE;
    measure({ width: 1_000, character: 9, before: 100 });
    vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
      return this.classList.contains("list") ? virtualList.room : 0;
    });
    render(<ArtifactLines id="lines" text={long} />);
    fireEvent.click(screen.getByTestId("lines-wrap"));
    expect([list().dataset.columns, row(1).style.height]).toEqual(["99", "60px"]);
    list().focus();
    press("ArrowDown");
    expect(focused()).toBe(row(1));
    const rooms = [inRoom()];
    const at = [1];

    for (let page = 0; page < 5; page += 1) {
      press("PageDown");
      rooms.push(inRoom());
      at.push(Number(focused().dataset.textLine));
    }
    // Each page goes on by the rows a room shows, less one line of it, and the line it goes to is in the room.
    expect(at).toEqual([1, 7, 13, 19, 25, 31]);
    for (let page = 1; page < rooms.length; page += 1) {
      expect([page, rooms[page].includes(at[page])]).toEqual([page, true]);
      // The first line of a room is one the room before it showed, or the one after its last.
      expect([page, rooms[page][0] <= (rooms[page - 1].at(-1) as number) + 1]).toEqual([page, true]);
    }
    // And back, the same way.
    const back = [inRoom()];

    for (let page = 0; page < 5; page += 1) {
      press("PageUp");
      back.push(inRoom());
    }
    expect(focused()).toBe(row(1));
    for (let page = 1; page < back.length; page += 1)
      expect([page, (back[page].at(-1) as number) >= back[page - 1][0] - 1]).toEqual([page, true]);
    // A row taller than the room is still left by a page: the list goes on by one row at least.
    virtualList.room = 2 * LINE;
    fireEvent(window, new Event("resize"));
    press("PageDown");
    expect(focused()).toBe(row(2));
    press("PageUp");
    expect(focused()).toBe(row(1));
  });

  it("go on from the line a command or a row was given the focus at", () => {
    render(<ArtifactLines id="lines" text={text} />);
    screen.getByTestId("lines-line-7-copy").focus();
    expect(reached()).toEqual([7]);
    press("ArrowDown");
    expect([focused(), reached()]).toEqual([row(8), [8]]);
    row(20).focus();
    expect(reached()).toEqual([20]);
    press("ArrowUp");
    expect(focused()).toBe(row(19));
  });

  it("are not lost with a row that leaves the list while it has the focus: the list takes it", () => {
    render(<ArtifactLines id="lines" text={text} />);
    row(1).focus();
    scroll(300 * LINE);
    expect(numbers().includes(1)).toBe(false);
    expect(focused()).toBe(list());
    // The list is still at the line it was at: the first key goes back to it.
    press("ArrowDown");
    expect(focused()).toBe(row(1));
  });
});
