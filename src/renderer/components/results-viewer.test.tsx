// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTENT } from "./artifact-viewer";
import { ResultsViewer } from "./results-viewer";

// What stands for the lines of a text, which another part draws: what it is given is what is under test.
vi.mock("./artifact-lines", () => ({
  ArtifactLines: ({ id, text, note }: { id: string; text: string; note?: string }) => (
    <div data-lines={id}>
      <p data-lines-note="">{note}</p>
      <pre data-lines-text="">{text}</pre>
    </div>
  ),
}));

// A message as the hook of the server of the reviewed release writes one: each part after a space, and
// only the parts the entry has, the message always among them.
const hook = (parts: { resource?: string; name?: string; message: string; error?: string }) =>
  `${parts.resource === undefined ? "" : ` resource: /${parts.resource}`}${
    parts.name === undefined ? "" : ` name: /${parts.name}`
  } message: /${parts.message}${parts.error === undefined ? "" : ` error: /${parts.error}`}`;

const CART = hook({ resource: "pods", name: "cart", message: "Error backing up item", error: "hook failed" });
const EXISTS = 'could not restore, ConfigMap "settings" already exists. Warning: the in-cluster version is different';
// Errors and warnings of the three places, written in another order than the one they are read in.
const WRITTEN = JSON.stringify({
  warnings: {
    namespaces: { shop: [EXISTS] },
    cluster: [hook({ resource: "customresourcedefinitions", message: "skipped by a policy" })],
    velero: [hook({ message: "a plugin is deprecated" })],
  },
  errors: {
    namespaces: {
      shop: [CART, hook({ resource: "pods", name: "pay", message: "Error backing up item", error: "timeout" })],
      billing: [hook({ name: "ledger", message: "skipped" })],
    },
    cluster: [hook({ resource: "persistentvolumes", name: "pv-1", message: "Error backing up item", error: "boom" })],
    velero: ["the store answered late"],
  },
});

// As many messages as asked, each told from the others.
const many = (count: number, word: string) => Array.from({ length: count }, (_, index) => `${word} ${index}`);
// Results of thousands of messages: more in the first two places than are shown at first.
const THOUSANDS = JSON.stringify({
  errors: {
    velero: many(150, "velero"),
    namespaces: { billing: many(120, "billing"), shop: many(3000, "shop") },
  },
  warnings: { cluster: many(7, "cluster") },
});

// The words of a part as they are heard: a mark that is hidden from who does not see says nothing.
function words(part: Element | null): string {
  const copy = part?.cloneNode(true) as Element | undefined;

  for (const mark of copy?.querySelectorAll('[aria-hidden="true"]') ?? []) mark.remove();
  return copy?.textContent ?? "";
}

// The words of what a part says it is named by.
const labelled = (part: Element) => words(document.getElementById(part.getAttribute("aria-labelledby") ?? "nothing"));
const viewer = () => screen.getByTestId("results");
const headings = () =>
  within(viewer())
    .getAllByRole("heading")
    .map((heading) => `${heading.tagName} ${words(heading)}`);
// The messages of a place, each as its parts by their names, or as the text it is.
const messages = (place: string) =>
  within(screen.getByTestId(`results-${place}`))
    .getAllByRole("listitem")
    .map((item) => {
      const names = [...item.querySelectorAll("dt")].map((name) => name.textContent);
      const values = [...item.querySelectorAll("dd")].map((value) => value.textContent);

      return names.length ? names.map((name, index) => `${name}: ${values[index]}`) : item.textContent;
    });
const mounted = () => within(viewer()).queryAllByRole("listitem").length;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the results of an operation", () => {
  it("shows the errors then the warnings, each by Velero, the cluster and the namespaces by name, with the counts", () => {
    render(<ResultsViewer id="results" text={WRITTEN} of="Backup" />);
    expect(screen.getByTestId("results-summary").textContent).toBe(
      "Velero recorded 8 messages for this backup: 5 errors and 3 warnings.",
    );
    // Headed lists: the groups, then the places of each, in the order of the page.
    expect(headings()).toEqual([
      "H3 Errors: 5",
      "H4 Velero: 1 error",
      "H4 Cluster: 1 error",
      "H4 Namespace billing: 1 error",
      "H4 Namespace shop: 2 errors",
      "H3 Warnings: 3",
      "H4 Velero: 1 warning",
      "H4 Cluster: 1 warning",
      "H4 Namespace shop: 1 warning",
    ]);
    // Each group is a part of the page named by its heading; each place of it holds one list, named by its own.
    const errors = screen.getByTestId("results-errors");
    const shop = screen.getByTestId("results-errors-namespace-shop");

    expect(within(viewer()).getAllByRole("region").map(labelled)).toEqual(["Errors: 5", "Warnings: 3"]);
    expect(errors.contains(shop)).toBe(true);
    expect(screen.getByTestId("results-warnings").contains(shop)).toBe(false);
    expect(within(shop).getAllByRole("list").map(labelled)).toEqual(["Namespace shop: 2 errors"]);
    expect(within(shop).getAllByRole("listitem")).toHaveLength(2);
    expect(within(viewer()).getAllByRole("list")).toHaveLength(7);
    expect(mounted()).toBe(8);
    // Nothing is cut of results of a few messages, and nothing says so.
    expect(screen.queryByTestId("results-shown")).toBeNull();
    expect(within(viewer()).queryAllByRole("button")).toEqual([]);
  });

  it("shows each message in the parts the hook of the server wrote, and as it is written", () => {
    render(<ResultsViewer id="results" text={WRITTEN} of="Backup" />);
    expect(messages("errors-namespace-shop")).toEqual([
      ["Resource: pods", "Name: cart", "Message: Error backing up item", "Error: hook failed"],
      ["Resource: pods", "Name: pay", "Message: Error backing up item", "Error: timeout"],
    ]);
    // Only the parts the entry had.
    expect(messages("errors-namespace-billing")).toEqual([["Name: ledger", "Message: skipped"]]);
    expect(messages("warnings-cluster")).toEqual([
      ["Resource: customresourcedefinitions", "Message: skipped by a policy"],
    ]);
    expect(messages("warnings-velero")).toEqual([["Message: a plugin is deprecated"]]);
    // As the hook wrote it, with the space it begins with.
    const [cart] = within(screen.getByTestId("results-errors-namespace-shop")).getAllByRole("listitem");

    expect(cart.querySelector("[data-written]")?.textContent).toBe(CART);
    expect(cart.querySelector('[data-part="error"]')?.textContent).toBe("hook failed");
    // A message of another form, as the ones of a restore are, is the text it is: it has no parts.
    expect(messages("warnings-namespace-shop")).toEqual([EXISTS]);
    expect(messages("errors-velero")).toEqual(["the store answered late"]);
    expect(screen.getByTestId("results-errors-velero").querySelector("dl, [data-written]")).toBeNull();
  });

  it("keeps an error of several lines, and says of a part that is empty that it is", () => {
    const text = JSON.stringify({
      errors: {
        velero: [
          hook({ message: "failed", error: "first line\nsecond line" }),
          hook({ resource: "", name: "", message: "" }),
        ],
      },
    });

    render(<ResultsViewer id="results" text={text} of="Restore" />);
    expect(messages("errors-velero")).toEqual([
      ["Message: failed", "Error: first line\nsecond line"],
      ["Resource: Empty", "Name: Empty", "Message: Empty"],
    ]);
  });

  it("says that Velero recorded no error and no warning when the results hold neither", () => {
    for (const [of, text, said] of [
      ["Backup", '{"errors":{},"warnings":{}}', "Velero recorded no error and no warning for this backup."],
      ["Restore", "{}", "Velero recorded no error and no warning for this restore."],
      ["Backup", '{"errors":{"namespaces":{"shop":[]}}}', "Velero recorded no error and no warning for this backup."],
    ] as const) {
      render(<ResultsViewer id="results" text={text} of={of} />);
      expect(screen.getByTestId("results-summary").textContent).toBe(said);
      // Nothing else is said of results that hold nothing: no group, no place, no list.
      expect(viewer().textContent).toBe(said);
      expect(within(viewer()).queryAllByRole("heading")).toEqual([]);
      expect(within(viewer()).queryAllByRole("list")).toEqual([]);
      cleanup();
    }
  });

  it("says of a group that holds nothing, beside one that holds something, that it holds none", () => {
    render(<ResultsViewer id="results" text={JSON.stringify({ warnings: { velero: ["late"] } })} of="Backup" />);
    expect(screen.getByTestId("results-summary").textContent).toBe(
      "Velero recorded 1 message for this backup: no error and 1 warning.",
    );
    expect(headings()).toEqual(["H3 Errors: none", "H3 Warnings: 1", "H4 Velero: 1 warning"]);
    expect(within(screen.getByTestId("results-errors")).queryAllByRole("list")).toEqual([]);
    // The group that holds nothing has no mark beside its title: the mark of an error is of errors that
    // are there. The one that holds something has its own.
    const mark = (group: string) => screen.getByTestId(`results-${group}`).querySelector("h3 i")?.textContent ?? null;

    expect([mark("errors"), mark("warnings")]).toEqual([null, "warning_amber"]);
    cleanup();
    render(<ResultsViewer id="results" text={JSON.stringify({ errors: { cluster: ["refused"] } })} of="Restore" />);
    expect(headings()).toEqual(["H3 Errors: 1", "H4 Cluster: 1 error", "H3 Warnings: none"]);
    expect([mark("errors"), mark("warnings")]).toEqual(["error_outline", null]);
  });

  it("marks the first part of what it shows, which can be given the focus and is not in the order of the keys", () => {
    render(<ResultsViewer id="results" text={WRITTEN} of="Backup" />);
    const marked = [...viewer().querySelectorAll<HTMLElement>(`[${CONTENT}]`)];
    const summary = screen.getByTestId("results-summary");

    expect(marked).toEqual([summary]);
    expect(viewer().firstElementChild).toBe(summary);
    expect(summary.getAttribute("tabindex")).toBe("-1");
    summary.focus();
    expect(document.activeElement).toBe(summary);
    cleanup();
    // The results that hold nothing have the mark as well: the focus has where to go.
    render(<ResultsViewer id="results" text="{}" of="Backup" />);
    expect(viewer().querySelector(`[${CONTENT}]`)).toBe(screen.getByTestId("results-summary"));
  });

  it("names every part it marks after the name it is given, which its root carries", () => {
    render(<ResultsViewer id="velero-backup-results" text={THOUSANDS} of="Backup" counters={{ errors: 9000 }} />);
    const root = screen.getByTestId("velero-backup-results");
    const marks = [...root.querySelectorAll("[data-testid]")].map((part) => part.getAttribute("data-testid") ?? "");
    const ids = [...root.querySelectorAll("[id]")].map((part) => part.id);

    expect(marks.length).toBeGreaterThan(8);
    expect(marks.filter((mark) => !mark.startsWith("velero-backup-results-"))).toEqual([]);
    expect(ids.filter((name) => !name.startsWith("velero-backup-results-"))).toEqual([]);
    // No two parts have the same name.
    expect(new Set(marks).size).toBe(marks.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names the list of a place by its heading, whatever its namespace is named", () => {
    const text = JSON.stringify({ errors: { velero: ["a"], namespaces: { "two words": ["b"], 'quo"ted': ["c"] } } });

    render(<ResultsViewer id="results" text={text} of="Backup" />);
    expect(within(viewer()).getAllByRole("region").map(labelled)).toEqual(["Errors: 3", "Warnings: none"]);
    expect(within(viewer()).getAllByRole("list").map(labelled)).toEqual([
      "Velero: 1 error",
      'Namespace quo"ted: 1 error',
      "Namespace two words: 1 error",
    ]);
    // An identifier is one word: a name of two would name two parts, and neither is there.
    for (const part of viewer().querySelectorAll("[id]")) expect(part.id).toMatch(/^\S+$/);
    expect(within(viewer()).getByRole("list", { name: "Namespace two words: 1 error" })).toBe(
      screen.getByTestId("results-errors-namespace-two words").querySelector("ul"),
    );
  });
});

describe("what the results write as attributes", () => {
  it("is what their words count: the errors and the warnings of the whole, the messages of each group, and of each place with where it is", () => {
    render(<ResultsViewer id="results" text={WRITTEN} of="Backup" />);
    expect(screen.getByTestId("results-summary").textContent).toBe(
      "Velero recorded 8 messages for this backup: 5 errors and 3 warnings.",
    );
    expect([viewer().getAttribute("data-errors"), viewer().getAttribute("data-warnings")]).toEqual(["5", "3"]);
    expect(
      ["errors", "warnings"].map((group) => screen.getByTestId(`results-${group}`).getAttribute("data-count")),
    ).toEqual(["5", "3"]);
    // A place says where it is, and the namespace it is of when it is of one.
    expect(
      [...viewer().querySelectorAll("[data-place]")].map((place) => [
        place.getAttribute("data-testid"),
        place.getAttribute("data-place"),
        place.getAttribute("data-namespace"),
        place.getAttribute("data-count"),
      ]),
    ).toEqual([
      ["results-errors-velero", "velero", null, "1"],
      ["results-errors-cluster", "cluster", null, "1"],
      ["results-errors-namespace-billing", "namespace", "billing", "1"],
      ["results-errors-namespace-shop", "namespace", "shop", "2"],
      ["results-warnings-velero", "velero", null, "1"],
      ["results-warnings-cluster", "cluster", null, "1"],
      ["results-warnings-namespace-shop", "namespace", "shop", "1"],
    ]);
  });

  it("is the messages each place holds, whatever is shown of them", () => {
    render(<ResultsViewer id="results" text={THOUSANDS} of="Backup" />);
    const held = () =>
      [...viewer().querySelectorAll("[data-place]")].map((place) => [
        place.getAttribute("data-testid"),
        place.getAttribute("data-count"),
      ]);
    const every = [
      ["results-errors-velero", "150"],
      ["results-errors-namespace-billing", "120"],
      ["results-errors-namespace-shop", "3000"],
      ["results-warnings-cluster", "7"],
    ];

    // Fifty of the messages of one place are shown, and none of another: each writes the ones it holds.
    expect(screen.getByTestId("results-errors-namespace-billing-shown").textContent).toBe("50 of 120 shown.");
    expect(screen.getByTestId("results-errors-namespace-shop-shown").textContent).toBe("0 of 3000 shown.");
    expect(held()).toEqual(every);
    fireEvent.click(screen.getByTestId("results-errors-namespace-shop-more"));
    expect(screen.getByTestId("results-errors-namespace-shop-shown").textContent).toBe("200 of 3000 shown.");
    expect(held()).toEqual(every);
  });

  it("is a count of none for results with no error and no warning, which have no group", () => {
    render(<ResultsViewer id="results" text={JSON.stringify({ errors: {}, warnings: {} })} of="Restore" />);
    expect([viewer().getAttribute("data-errors"), viewer().getAttribute("data-warnings")]).toEqual(["0", "0"]);
    expect(viewer().querySelectorAll("[data-count]")).toHaveLength(0);
  });
});

describe("the count of the results beside the counters of the status", () => {
  it("says both counts of a backup whose status counts more errors, and that its plugins add to the status", () => {
    render(<ResultsViewer id="results" text={WRITTEN} of="Backup" counters={{ errors: 7, warnings: 3 }} />);
    expect(words(screen.getByTestId("results-differs"))).toBe(
      "The status of the backup reports 7 errors, and its results hold 5. The operations of the plugins of a backup add their errors to its status after its results were written, and not to the results: the status can count more.",
    );
    // It is said after the count of the whole and before the messages.
    const parts = [...viewer().children].map((part) => part.getAttribute("data-testid"));

    expect(parts).toEqual(["results-summary", "results-differs", "results-errors", "results-warnings"]);
  });

  it("says of a restore whose status counts more errors what it says of a backup: that its plugins add to the status", () => {
    render(<ResultsViewer id="results" text={WRITTEN} of="Restore" counters={{ errors: 7, warnings: 3 }} />);
    expect(words(screen.getByTestId("results-differs"))).toBe(
      "The status of the restore reports 7 errors, and its results hold 5. The operations of the plugins of a restore add their errors to its status after its results were written, and not to the results: the status can count more.",
    );
  });

  it("names no reason for a restore whose counts differ in another way, unless it is being finalized", () => {
    const { rerender } = render(
      <ResultsViewer
        id="results"
        text={WRITTEN}
        of="Restore"
        counters={{ errors: 4, warnings: 5 }}
        phase="Completed"
      />,
    );

    expect(words(screen.getByTestId("results-differs"))).toBe(
      "The status of the restore reports 4 errors, and its results hold 5. The status of the restore reports 5 warnings, and its results hold 3. They differ for a reason the extension does not name.",
    );
    // The phase the object reports is given with its counters: while a restore is finalized its results
    // are added to before its status is written, which explains results that count more.
    rerender(
      <ResultsViewer
        id="results"
        text={WRITTEN}
        of="Restore"
        counters={{ errors: 4, warnings: 3 }}
        phase="Finalizing"
      />,
    );
    expect(words(screen.getByTestId("results-differs"))).toBe(
      "The status of the restore reports 4 errors, and its results hold 5. When Velero finalizes a restore it adds what it finds to the results before it writes the status: the results can count more until the restore ends.",
    );
  });

  it("says each count of a backup with its own reason, and names none for its warnings", () => {
    render(<ResultsViewer id="results" text={WRITTEN} of="Backup" counters={{ errors: 6, warnings: 1 }} />);
    const said = [...screen.getByTestId("results-differs").querySelectorAll("p")].map((line) => line.textContent);

    expect(said).toEqual([
      "The status of the backup reports 6 errors, and its results hold 5. The operations of the plugins of a backup add their errors to its status after its results were written, and not to the results: the status can count more.",
      "The status of the backup reports 1 warning, and its results hold 3. They differ for a reason the extension does not name.",
    ]);
  });

  it("says a status that counts something of results that hold nothing", () => {
    render(<ResultsViewer id="results" text="{}" of="Backup" counters={{ errors: 2 }} />);
    expect(screen.getByTestId("results-summary").textContent).toBe(
      "Velero recorded no error and no warning for this backup.",
    );
    expect(words(screen.getByTestId("results-differs"))).toContain(
      "The status of the backup reports 2 errors, and its results hold none.",
    );
  });

  it("says nothing of it when the counts agree, or when the status reports none", () => {
    for (const counters of [{ errors: 5, warnings: 3 }, { errors: 5 }, { warnings: 3 }, {}, undefined]) {
      for (const of of ["Backup", "Restore"] as const) {
        render(<ResultsViewer id="results" text={WRITTEN} of={of} counters={counters} />);
        expect([counters, of, screen.queryByTestId("results-differs")]).toEqual([counters, of, null]);
        expect(viewer().textContent).not.toContain("status");
        cleanup();
      }
    }
  });
});

describe("a text that is not of the shape of the results", () => {
  it("is shown as the text it is, with the note that its shape is not the one the extension was written for", () => {
    for (const text of [
      "not JSON",
      "",
      "[]",
      "null",
      '{"errors":{"elsewhere":["x"]},"warnings":{}}',
      '{"errors":[]}',
    ]) {
      const { container } = render(<ResultsViewer id="results" text={text} of="Backup" counters={{ errors: 3 }} />);
      const lines = container.querySelector('[data-lines="results"]');

      expect([text, lines?.querySelector("[data-lines-text]")?.textContent]).toEqual([text, text]);
      expect(lines?.querySelector("[data-lines-note]")?.textContent).toBe(
        "The results of this backup are not of the shape the extension was written for: they are shown as the text they are.",
      );
      // Nothing is counted of a text that was not read, and nothing of the results is drawn around it.
      expect(container.firstElementChild).toBe(lines);
      expect(container.textContent).not.toContain("Velero recorded");
      expect(container.textContent).not.toContain("status");
      cleanup();
    }
  });

  it("says of which operation the text is, and takes the place of results that were of the shape", () => {
    const { container, rerender } = render(<ResultsViewer id="results" text={WRITTEN} of="Restore" />);

    expect(container.querySelector("[data-lines]")).toBeNull();
    rerender(<ResultsViewer id="results" text={'{"results":"of another release"}'} of="Restore" />);
    expect(container.querySelector("[data-lines-note]")?.textContent).toContain("The results of this restore are not");
    expect(screen.queryByTestId("results-summary")).toBeNull();
    // And back: a text of the shape is read as results again.
    rerender(<ResultsViewer id="results" text="{}" of="Restore" />);
    expect(container.querySelector("[data-lines]")).toBeNull();
    expect(screen.getByTestId("results-summary").textContent).toContain("no error and no warning");
  });
});

describe("the results of thousands of messages", () => {
  it("parses a text once, however many times it is drawn again", () => {
    const parse = vi.spyOn(JSON, "parse");
    const parsed = (text: string) => parse.mock.calls.filter(([given]) => given === text).length;
    const { rerender } = render(<ResultsViewer id="results" text={THOUSANDS} of="Backup" />);

    rerender(<ResultsViewer id="results" text={THOUSANDS} of="Backup" counters={{ errors: 3271 }} />);
    rerender(<ResultsViewer id="results" text={THOUSANDS} of="Backup" counters={{ errors: 3270 }} />);
    fireEvent.click(screen.getByTestId("results-errors-namespace-billing-more"));
    fireEvent.click(screen.getByTestId("results-errors-namespace-shop-more"));
    expect(parsed(THOUSANDS)).toBe(1);
    // Another text is another one to read.
    rerender(<ResultsViewer id="results" text={WRITTEN} of="Backup" />);
    expect([parsed(THOUSANDS), parsed(WRITTEN)]).toEqual([1, 1]);
    expect(screen.getByTestId("results-summary").textContent).toContain("8 messages");
  });

  it("shows the first two hundred in the order of the page, and every count all the same", () => {
    render(<ResultsViewer id="results" text={THOUSANDS} of="Backup" />);
    expect(screen.getByTestId("results-summary").textContent).toBe(
      "Velero recorded 3277 messages for this backup: 3270 errors and 7 warnings.",
    );
    expect(headings()).toEqual([
      "H3 Errors: 3270",
      "H4 Velero: 150 errors",
      "H4 Namespace billing: 120 errors",
      "H4 Namespace shop: 3000 errors",
      "H3 Warnings: 7",
      "H4 Cluster: 7 warnings",
    ]);
    expect(mounted()).toBe(200);
    expect(screen.getByTestId("results-shown").textContent).toBe(
      "200 of the 3277 messages are shown. The others are shown by the command of their place.",
    );
    // The place the bound falls in shows its first ones, and the ones after it none: each says how many.
    expect(messages("errors-velero")).toHaveLength(150);
    expect(screen.queryByTestId("results-errors-velero-more")).toBeNull();
    expect(messages("errors-namespace-billing")).toHaveLength(50);
    expect(messages("errors-namespace-billing")[49]).toBe("billing 49");
    expect(screen.getByTestId("results-errors-namespace-billing-shown").textContent).toBe("50 of 120 shown.");
    expect(within(screen.getByTestId("results-errors-namespace-shop")).queryAllByRole("list")).toEqual([]);
    expect(screen.getByTestId("results-errors-namespace-shop-shown").textContent).toBe("0 of 3000 shown.");
    expect(screen.getByTestId("results-warnings-cluster-shown").textContent).toBe("0 of 7 shown.");
    // The commands are buttons, each told from the others by its name.
    expect(
      within(viewer())
        .getAllByRole("button")
        .map((command) => command.textContent),
    ).toEqual([
      "Show 70 more errors of the namespace billing",
      "Show 200 more errors of the namespace shop",
      "Show 7 more warnings of the cluster",
    ]);
  });

  it("shows the ones after them where it is asked, two hundred at a time, and gives the focus to the first", () => {
    render(<ResultsViewer id="results" text={THOUSANDS} of="Backup" />);
    const focused = () => document.activeElement?.textContent;

    fireEvent.click(screen.getByTestId("results-errors-namespace-shop-more"));
    expect(messages("errors-namespace-shop")).toHaveLength(200);
    expect(focused()).toBe("shop 0");
    expect(screen.getByTestId("results-errors-namespace-shop-shown").textContent).toBe("200 of 3000 shown.");
    fireEvent.click(screen.getByTestId("results-errors-namespace-shop-more"));
    expect(messages("errors-namespace-shop")).toHaveLength(400);
    // The first of the ones that were added, and not the first of the place again.
    expect(focused()).toBe("shop 200");
    expect(mounted()).toBe(600);
    expect(screen.getByTestId("results-shown").textContent).toContain("600 of the 3277 messages are shown.");
    // The other places are as they were: what is asked of one is not asked of another.
    expect(messages("errors-namespace-billing")).toHaveLength(50);
    // A place that is shown whole has no command any more, and the focus is on a message, not on nothing.
    fireEvent.click(screen.getByTestId("results-errors-namespace-billing-more"));
    expect(messages("errors-namespace-billing")).toHaveLength(120);
    expect(screen.queryByTestId("results-errors-namespace-billing-more")).toBeNull();
    expect(screen.queryByTestId("results-errors-namespace-billing-shown")).toBeNull();
    expect(focused()).toBe("billing 50");
    fireEvent.click(screen.getByTestId("results-warnings-cluster-more"));
    expect(focused()).toBe("cluster 0");
    expect(mounted()).toBe(677);
    // A step that is longer than what is left of a place adds what is left, and no more is counted.
    expect(screen.getByTestId("results-shown").textContent).toContain("677 of the 3277 messages are shown.");
    // A message that has the focus is not in the order of the keys.
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
  });

  it("starts from the first ones again for another text", () => {
    const { rerender } = render(<ResultsViewer id="results" text={THOUSANDS} of="Backup" />);

    fireEvent.click(screen.getByTestId("results-errors-namespace-billing-more"));
    fireEvent.click(screen.getByTestId("results-errors-namespace-shop-more"));
    expect(mounted()).toBe(470);
    // The same places, written again with one message more: what was asked was asked of the other text.
    const again = JSON.stringify({ ...JSON.parse(THOUSANDS), warnings: { cluster: many(8, "cluster") } });

    rerender(<ResultsViewer id="results" text={again} of="Backup" />);
    expect(mounted()).toBe(200);
    expect(messages("errors-namespace-billing")).toHaveLength(50);
    expect(screen.getByTestId("results-errors-namespace-shop-shown").textContent).toBe("0 of 3000 shown.");
    // No message was added to this text: the focus is not moved by drawing it.
    expect(document.activeElement?.textContent).not.toBe("billing 50");
    // The same text given again keeps what was asked of it.
    fireEvent.click(screen.getByTestId("results-warnings-cluster-more"));
    rerender(<ResultsViewer id="results" text={again} of="Backup" counters={{ warnings: 8 }} />);
    expect(mounted()).toBe(208);
  });

  it("shows whole the results that hold as many messages as the bound, and cuts the ones of one more", () => {
    const { rerender } = render(
      <ResultsViewer id="results" text={JSON.stringify({ errors: { velero: many(200, "m") } })} of="Backup" />,
    );

    expect([mounted(), screen.queryByTestId("results-shown")]).toEqual([200, null]);
    expect(within(viewer()).queryAllByRole("button")).toEqual([]);
    rerender(<ResultsViewer id="results" text={JSON.stringify({ errors: { velero: many(201, "m") } })} of="Backup" />);
    expect(mounted()).toBe(200);
    expect(screen.getByTestId("results-errors-velero-more").textContent).toBe("Show 1 more error of Velero");
  });
});
