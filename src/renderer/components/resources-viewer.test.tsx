// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { virtualList } from "../../../test/host-components";
import { CONTENT } from "./artifact-viewer";
import { ResourcesViewer } from "./resources-viewer";
import styles from "./views.module.css";

// What stands for the lines of a text: they are of another part, and the viewer is checked for what it
// gives them.
const lines = vi.hoisted(() => ({ given: [] as { id: string; text: string; note?: string }[] }));

vi.mock("./artifact-lines", () => ({
  ArtifactLines: (props: { id: string; text: string; note?: string }) => {
    lines.given.push(props);
    return <div data-lines={props.id} />;
  },
}));

const BACKUP = JSON.stringify({
  "v1/Pod": ["shop/cart", "shop/pay", "billing/ledger"],
  "apps/v1/Deployment": ["shop/cart"],
  "v1/Namespace": ["shop", "billing"],
  "rbac.authorization.k8s.io/v1/ClusterRole": ["system:node"],
});
const RESTORE = JSON.stringify({
  "v1/Pod": ["shop/cart(created)", "shop/pay(failed)", "billing/ledger(skipped)"],
  "v1/ConfigMap": ["shop/settings(updated)", "shop/old", "shop/odd(replaced)"],
  "v1/Namespace": ["shop(created)"],
});
// Fifty thousand items of twenty-five resources, two thousand of each.
const LARGE = JSON.stringify(
  Object.fromEntries(
    Array.from({ length: 25 }, (_, kind) => [
      `group-${String(kind).padStart(2, "0")}.example/v1/Kind${kind}`,
      Array.from({ length: 2000 }, (_, item) => `ns-${item % 50}/item-${String(item).padStart(5, "0")}`),
    ]),
  ),
);
// The height the host gives a row of its tables.
const ROW = 33;
// The rows the table shows at least, where it has as many, and at most, which is its tallest room.
const LEAST = 6;
const MOST = 20;
// The rows the list of the host mounts at most: the twenty of the tallest room and one that is cut, and
// ten on each side.
const MOUNTED = 41;
// The room the list of the tests measures when a test says nothing of it.
const ROOM_OF_THE_TESTS = virtualList.room;
const FILTER = "Filter by resource, namespace or name";
const TYPED = "carries what was typed in its resource, its namespace or its name";

const count = () => screen.getByTestId("resources-count").textContent;
const head = () =>
  [...screen.getByTestId("resources-table").querySelectorAll(".TableHead .TableCell")].map((cell) => cell.textContent);
const mounted = () => [...screen.getByTestId("resources-rows").querySelectorAll(".TableRow")];
// The rows that are mounted, in their order: a resource with its count, or an item with its cells.
const rows = () => mounted().map((row) => [...row.querySelectorAll(".TableCell")].map((cell) => cell.textContent));
const type = (words: string) => fireEvent.change(screen.getByLabelText(FILTER), { target: { value: words } });
const choices = () =>
  within(screen.getByTestId("resources-actions"))
    .getAllByRole("button")
    .map((choice) => [choice.textContent, choice.getAttribute("aria-pressed")]);
const scroll = (to: number) => fireEvent.scroll(screen.getByTestId("resources-rows"), { target: { scrollTop: to } });
const resize = (height: number) => {
  window.innerHeight = height;
  fireEvent(window, new Event("resize"));
};
// The least and the most the viewer gives the room of its rows.
const room = () => {
  const { minHeight, maxHeight } = screen.getByTestId("resources-room").style;

  return [minHeight, maxHeight];
};

// The room of the rows is the tallest the table is given, unless a test says another.
beforeEach(() => {
  virtualList.room = MOST * ROW;
});

afterEach(() => {
  cleanup();
  lines.given.length = 0;
  window.innerHeight = 768;
  virtualList.room = ROOM_OF_THE_TESTS;
});

describe("the resource list of a backup", () => {
  it("shows the resources by their API version and kind, sorted, each with its items sorted, the count of each and of the whole", () => {
    render(<ResourcesViewer id="resources" text={BACKUP} of="Backup" />);
    expect(count()).toBe("7 items of 4 resources.");
    expect(head()).toEqual(["Namespace", "Name"]);
    expect(rows()).toEqual([
      ["apps/v1/Deployment", "1 item"],
      ["shop", "cart"],
      ["rbac.authorization.k8s.io/v1/ClusterRole", "1 item"],
      ["cluster", "system:node"],
      ["v1/Namespace", "2 items"],
      ["cluster", "billing"],
      ["cluster", "shop"],
      ["v1/Pod", "3 items"],
      ["billing", "ledger"],
      ["shop", "cart"],
      ["shop", "pay"],
    ]);
    // A row is found by what it is of: a resource by its name, an item by its text as it is written.
    expect(screen.getAllByTestId("resources-kind").map((row) => row.getAttribute("data-resource"))).toEqual([
      "apps/v1/Deployment",
      "rbac.authorization.k8s.io/v1/ClusterRole",
      "v1/Namespace",
      "v1/Pod",
    ]);
    expect(screen.getAllByTestId("resources-item").map((row) => row.getAttribute("data-item"))).toEqual([
      "shop/cart",
      "system:node",
      "billing",
      "shop",
      "billing/ledger",
      "shop/cart",
      "shop/pay",
    ]);
  });

  it("has no column of the action and no filter by action, and takes no action out of a name", () => {
    render(<ResourcesViewer id="resources" text={RESTORE} of="Backup" />);
    expect(head()).toEqual(["Namespace", "Name"]);
    expect(screen.queryByTestId("resources-actions")).toBeNull();
    expect(screen.getByTestId("resources").querySelector(".TableCell.action")).toBeNull();
    expect(rows().slice(0, 4)).toEqual([
      ["v1/ConfigMap", "3 items"],
      ["shop", "odd(replaced)"],
      ["shop", "old"],
      ["shop", "settings(updated)"],
    ]);
  });

  it("keeps no choice of an action when it takes the place of the list of a restore", () => {
    const { rerender } = render(<ResourcesViewer id="resources" text={RESTORE} of="Restore" />);

    fireEvent.click(screen.getByTestId("resources-action-failed"));
    expect(rows()).toHaveLength(2);
    rerender(<ResourcesViewer id="resources" text={BACKUP} of="Backup" />);
    expect(count()).toBe("7 items of 4 resources.");
    expect(rows()).toHaveLength(11);
  });

  it("says cluster in the namespace column of an item of the cluster, with a mark a namespace of that name has not", () => {
    render(
      <ResourcesViewer
        id="resources"
        text={JSON.stringify({ "v1/Namespace": ["cluster"], "v1/Secret": ["cluster/token"] })}
        of="Backup"
      />,
    );
    expect(rows()).toEqual([
      ["v1/Namespace", "1 item"],
      ["cluster", "cluster"],
      ["v1/Secret", "1 item"],
      ["cluster", "token"],
    ]);
    const [ofCluster, ofNamespace] = screen
      .getAllByTestId("resources-item")
      .map((row) => row.querySelector(".TableCell.namespace"));

    expect(ofCluster?.querySelector('[data-scope="cluster"]')?.textContent).toBe("cluster");
    expect(ofNamespace?.querySelector("[data-scope]")).toBeNull();
    // The words of the mark say what it is to who points at it.
    expect(ofCluster?.querySelector("[data-scope]")?.getAttribute("title")).toBe(
      "An item of the cluster: it is of no namespace",
    );
  });

  it("shows a text that is cut in its cell whole to who points at it", () => {
    const long = "a".repeat(253);

    render(
      <ResourcesViewer
        id="resources"
        text={JSON.stringify({ "long.group.example/v1/Kind": [`${long}/${long}`] })}
        of="Backup"
      />,
    );
    const item = screen.getByTestId("resources-item");

    expect(screen.getByTestId("resources-kind").querySelector(".resource [title]")?.getAttribute("title")).toBe(
      "long.group.example/v1/Kind",
    );
    expect(item.querySelector(".namespace [title]")?.getAttribute("title")).toBe(long);
    expect(item.querySelector(".name [title]")?.getAttribute("title")).toBe(long);
    expect(item.querySelector(".name")?.textContent).toBe(long);
  });

  it("says that a list holds no item, with no filter, and shows a resource that has none", () => {
    const { unmount } = render(<ResourcesViewer id="resources" text="{}" of="Backup" />);

    expect(count()).toBe("The resource list holds no item.");
    expect(screen.queryByTestId("resources-filter")).toBeNull();
    expect(screen.queryByTestId("resources-table")).toBeNull();
    unmount();
    render(<ResourcesViewer id="resources" text='{"v1/Pod":[]}' of="Restore" />);
    expect(count()).toBe("The resource list holds no item.");
    expect(screen.queryByTestId("resources-filter")).toBeNull();
    expect(screen.queryByTestId("resources-actions")).toBeNull();
    expect(rows()).toEqual([["v1/Pod", "No item"]]);
  });
});

describe("the resource list of a restore", () => {
  it("shows the action after each item as a column, the four of them, and as not stated an item without one and one with an action the release does not write, which keep their text", () => {
    render(<ResourcesViewer id="resources" text={RESTORE} of="Restore" />);
    expect(count()).toBe("7 items of 3 resources.");
    expect(head()).toEqual(["Namespace", "Name", "Action"]);
    expect(rows()).toEqual([
      ["v1/ConfigMap", "3 items"],
      ["shop", "odd(replaced)", "not stated"],
      ["shop", "old", "not stated"],
      ["shop", "settings", "updated"],
      ["v1/Namespace", "1 item"],
      ["cluster", "shop", "created"],
      ["v1/Pod", "3 items"],
      ["billing", "ledger", "skipped"],
      ["shop", "cart", "created"],
      ["shop", "pay", "failed"],
    ]);
    // The action of a row is told apart from the words of one that has none.
    expect(
      screen
        .getAllByTestId("resources-item")
        .map((row) => row.querySelector("[data-action]")?.getAttribute("data-action")),
    ).toEqual(["", "", "updated", "created", "skipped", "created", "failed"]);
    // The action that failed has the look of a failure, and it alone: the others are plain words.
    const look = (action: string) =>
      screen.getByTestId("resources").querySelector(`[data-action="${action}"]`)?.className;

    expect(styles.resourcesFailed).toBeTruthy();
    expect(["created", "updated", "skipped", "failed"].map((action) => [action, look(action)])).toEqual([
      ["created", ""],
      ["updated", ""],
      ["skipped", ""],
      ["failed", styles.resourcesFailed],
    ]);
  });

  it("counts each action on the choices of a named group, which say which one is chosen, and narrows the items by it", () => {
    render(<ResourcesViewer id="resources" text={RESTORE} of="Restore" />);
    const group = screen.getByRole("group", { name: "Show the items by what the restore did with them" });

    expect(group).toBe(screen.getByTestId("resources-actions"));
    expect(choices()).toEqual([
      ["All: 7", "true"],
      ["Created: 2", "false"],
      ["Updated: 1", "false"],
      ["Failed: 1", "false"],
      ["Skipped: 1", "false"],
      ["Not stated: 2", "false"],
    ]);
    fireEvent.click(screen.getByTestId("resources-action-failed"));
    expect(rows()).toEqual([
      ["v1/Pod", "1 of 3 items"],
      ["shop", "pay", "failed"],
    ]);
    expect(count()).toBe("1 of 7 items, of 1 of 3 resources.");
    // The counts of the choices are the ones each would leave: they do not follow the one that is chosen.
    expect(choices()).toEqual([
      ["All: 7", "false"],
      ["Created: 2", "false"],
      ["Updated: 1", "false"],
      ["Failed: 1", "true"],
      ["Skipped: 1", "false"],
      ["Not stated: 2", "false"],
    ]);
    fireEvent.click(screen.getByTestId("resources-action-not-stated"));
    expect(rows()).toEqual([
      ["v1/ConfigMap", "2 of 3 items"],
      ["shop", "odd(replaced)", "not stated"],
      ["shop", "old", "not stated"],
    ]);
    expect(count()).toBe("2 of 7 items, of 1 of 3 resources.");
    fireEvent.click(screen.getByTestId("resources-action-all"));
    expect(rows()).toHaveLength(10);
    expect(count()).toBe("7 items of 3 resources.");
    expect(choices()[0]).toEqual(["All: 7", "true"]);
  });

  it("counts on the choices what the words leave of each action, and of how many, and says in words that nothing is left", () => {
    render(<ResourcesViewer id="resources" text={RESTORE} of="Restore" />);
    type("shop");
    expect(choices().map(([text]) => text)).toEqual([
      "All: 6 of 7",
      "Created: 2 of 2",
      "Updated: 1 of 1",
      "Failed: 1 of 1",
      "Skipped: 0 of 1",
      "Not stated: 2 of 2",
    ]);
    fireEvent.click(screen.getByTestId("resources-action-skipped"));
    expect(count()).toBe(`Of 7 items, none was skipped and ${TYPED}.`);
    expect(screen.queryByTestId("resources-table")).toBeNull();
    // The filter stays where it is, to be changed.
    expect(choices()[4]).toEqual(["Skipped: 0 of 1", "true"]);
    type("");
    expect(rows()).toEqual([
      ["v1/Pod", "1 of 3 items"],
      ["billing", "ledger", "skipped"],
    ]);
    expect(choices()[4]).toEqual(["Skipped: 1", "true"]);
    // Blank spaces are no words: the choices count what they count with nothing typed, and not of how many.
    type("   ");
    expect(choices().map(([text]) => text)).toEqual([
      "All: 7",
      "Created: 2",
      "Updated: 1",
      "Failed: 1",
      "Skipped: 1",
      "Not stated: 2",
    ]);
    expect(rows()[0]).toEqual(["v1/Pod", "1 of 3 items"]);
  });
});

describe("what a resource list writes as attributes", () => {
  it("is what its words count: the items and the resources of the list, the ones a filter leaves, the items of each resource and what each choice would leave", () => {
    render(<ResourcesViewer id="resources" text={RESTORE} of="Restore" />);
    const whole = () =>
      ["data-items", "data-resources", "data-left-items", "data-left-resources"].map((name) =>
        screen.getByTestId("resources").getAttribute(name),
      );
    const kinds = () =>
      screen
        .getAllByTestId("resources-kind")
        .map((row) => [row.getAttribute("data-resource"), row.getAttribute("data-count")]);
    const left = () =>
      within(screen.getByTestId("resources-actions"))
        .getAllByRole("button")
        .map((choice) => choice.getAttribute("data-count"));

    expect([count(), whole()]).toEqual(["7 items of 3 resources.", ["7", "3", "7", "3"]]);
    expect(kinds()).toEqual([
      ["v1/ConfigMap", "3"],
      ["v1/Namespace", "1"],
      ["v1/Pod", "3"],
    ]);
    expect(left()).toEqual(["7", "2", "1", "1", "1", "2"]);
    // The words leave six items of the three resources, and each choice counts what it would leave of those.
    type("shop");
    expect(whole()).toEqual(["7", "3", "6", "3"]);
    expect(choices().map(([text]) => text)).toEqual([
      "All: 6 of 7",
      "Created: 2 of 2",
      "Updated: 1 of 1",
      "Failed: 1 of 1",
      "Skipped: 0 of 1",
      "Not stated: 2 of 2",
    ]);
    expect(left()).toEqual(["6", "2", "1", "1", "0", "2"]);
    // A choice leaves its items, and a resource counts the ones of it that are left.
    fireEvent.click(screen.getByTestId("resources-action-created"));
    expect(whole()).toEqual(["7", "3", "2", "2"]);
    expect(kinds()).toEqual([
      ["v1/Namespace", "1"],
      ["v1/Pod", "1"],
    ]);
    // Each choice still counts what it would leave of what the words left, whichever of them is made.
    expect(left()).toEqual(["6", "2", "1", "1", "0", "2"]);
  });
});

describe("the parts of the viewer of a resource list", () => {
  it("are found by the name the viewer is given: its root carries it, and every part a name that begins with it", () => {
    const { container } = render(<ResourcesViewer id="velero-restore-resources" text={RESTORE} of="Restore" />);
    const names = [...container.querySelectorAll("[data-testid]")].map((part) => part.getAttribute("data-testid"));

    expect(container.firstElementChild?.getAttribute("data-testid")).toBe("velero-restore-resources");
    expect([...new Set(names)].sort()).toEqual([
      "velero-restore-resources",
      "velero-restore-resources-action-all",
      "velero-restore-resources-action-created",
      "velero-restore-resources-action-failed",
      "velero-restore-resources-action-not-stated",
      "velero-restore-resources-action-skipped",
      "velero-restore-resources-action-updated",
      "velero-restore-resources-actions",
      "velero-restore-resources-count",
      "velero-restore-resources-filter",
      "velero-restore-resources-item",
      "velero-restore-resources-kind",
      "velero-restore-resources-room",
      "velero-restore-resources-rows",
      "velero-restore-resources-table",
    ]);
  });
});

describe("the filter of a resource list", () => {
  it("is a labelled field that narrows the items by the resource, the namespace and the name, with counts that follow what is left and say of how many", () => {
    render(<ResourcesViewer id="resources" text={BACKUP} of="Backup" />);
    expect(screen.getByLabelText(FILTER)).toBe(screen.getByTestId("resources-filter"));
    // The field keeps the focus when Enter is pressed in it, which the host would take from it.
    screen.getByLabelText(FILTER).focus();
    fireEvent.keyDown(screen.getByLabelText(FILTER), { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByLabelText(FILTER));
    type("POD");
    expect(rows()).toEqual([
      ["v1/Pod", "3 of 3 items"],
      ["billing", "ledger"],
      ["shop", "cart"],
      ["shop", "pay"],
    ]);
    expect(count()).toBe("3 of 7 items, of 1 of 4 resources.");
    type("billing");
    expect(rows()).toEqual([
      ["v1/Namespace", "1 of 2 items"],
      ["cluster", "billing"],
      ["v1/Pod", "1 of 3 items"],
      ["billing", "ledger"],
    ]);
    expect(count()).toBe("2 of 7 items, of 2 of 4 resources.");
    type("pod cart");
    expect(rows()).toEqual([
      ["v1/Pod", "1 of 3 items"],
      ["shop", "cart"],
    ]);
    type("   ");
    expect(rows()).toHaveLength(11);
    expect(count()).toBe("7 items of 4 resources.");
    // Blank spaces are no words: no resource says of how many its items are.
    expect(screen.getAllByTestId("resources-kind").map((row) => row.querySelector(".count")?.textContent)).toEqual([
      "1 item",
      "1 item",
      "2 items",
      "3 items",
    ]);
  });

  it("keeps Escape for itself, as the search of the host does: it clears what was typed, and the key goes no further", () => {
    const heard: string[] = [];

    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: what holds the viewer, which listens to the keys as the workspace of the view does
      <div onKeyDown={(event) => heard.push(event.key)}>
        <ResourcesViewer id="resources" text={BACKUP} of="Backup" />
      </div>,
    );
    type("pod cart");
    expect(count()).toBe("1 of 7 items, of 1 of 4 resources.");
    fireEvent.keyDown(screen.getByLabelText(FILTER), { key: "Escape" });
    expect((screen.getByLabelText(FILTER) as HTMLInputElement).value).toBe("");
    expect(count()).toBe("7 items of 4 resources.");
    expect(heard).toEqual([]);
    // With nothing typed the key is still of the field: the view is not left from inside it.
    fireEvent.keyDown(screen.getByLabelText(FILTER), { key: "Escape" });
    expect(heard).toEqual([]);
    // The other keys of the field, and Escape anywhere else in the viewer, are heard by what holds it.
    fireEvent.keyDown(screen.getByLabelText(FILTER), { key: "a" });
    fireEvent.keyDown(screen.getByTestId("resources-rows"), { key: "Escape" });
    expect(heard).toEqual(["a", "Escape"]);
  });

  it("says in words that nothing is left, in place of the table, and shows the table again when something is", () => {
    render(<ResourcesViewer id="resources" text={BACKUP} of="Backup" />);
    type("no such thing");
    expect(count()).toBe(`Of 7 items, none ${TYPED}.`);
    expect(screen.queryByTestId("resources-table")).toBeNull();
    expect((screen.getByLabelText(FILTER) as HTMLInputElement).value).toBe("no such thing");
    type("node");
    expect(rows()).toEqual([
      ["rbac.authorization.k8s.io/v1/ClusterRole", "1 of 1 item"],
      ["cluster", "system:node"],
    ]);
  });

  it("tells the counts to who does not see when the filter changes them, in the part that is given the focus when the text arrives", () => {
    render(<ResourcesViewer id="resources" text={RESTORE} of="Restore" />);
    const told = screen.getByRole("status");
    const first = screen.getByTestId("resources").querySelector<HTMLElement>(`[${CONTENT}]`);

    expect(told.textContent).toBe("7 items of 3 resources.");
    type("pod");
    expect(told.textContent).toBe("3 of 7 items, of 1 of 3 resources.");
    fireEvent.click(screen.getByTestId("resources-action-updated"));
    expect(told.textContent).toBe(`Of 7 items, none was updated and ${TYPED}.`);
    // The first part of the viewer holds what is told: it can be given the focus, and the Tab key does
    // not stop on it.
    expect(first).toBe(screen.getByTestId("resources").firstElementChild);
    expect(first).toBe(screen.getByTestId("resources-count"));
    expect(first?.contains(told)).toBe(true);
    expect(first?.tabIndex).toBe(-1);
    first?.focus();
    expect(document.activeElement).toBe(first);
  });

  it("parses a text once: neither the filter nor what holds the viewer, drawn again, parses anything, and another text is parsed", () => {
    const parse = vi.spyOn(JSON, "parse");
    // Every text that was parsed, in the order it was.
    const parsed = () => parse.mock.calls.map(([given]) => given);
    const { rerender } = render(<ResourcesViewer id="resources" text={RESTORE} of="Restore" />);

    expect(parsed()).toEqual([RESTORE]);
    type("shop");
    fireEvent.click(screen.getByTestId("resources-action-failed"));
    type("");
    resize(400);
    fireEvent.click(screen.getByTestId("resources-action-all"));
    expect(rows()).toHaveLength(10);
    expect(parsed()).toEqual([RESTORE]);
    rerender(<ResourcesViewer id="resources" text={RESTORE} of="Restore" />);
    expect(parsed()).toEqual([RESTORE]);
    rerender(<ResourcesViewer id="resources" text={BACKUP} of="Backup" />);
    expect(count()).toBe("7 items of 4 resources.");
    expect(parsed()).toEqual([RESTORE, BACKUP]);
    parse.mockRestore();
  });
});

describe("a large resource list", () => {
  it("mounts the rows of its room and ten on each side, and no other, of fifty thousand items, wherever it is scrolled", () => {
    render(<ResourcesViewer id="resources" text={LARGE} of="Backup" />);
    expect(count()).toBe("50000 items of 25 resources.");
    // The room is of twenty rows at most, which the view leaves here: the first is the first resource,
    // and thirty are mounted.
    expect(room()).toEqual([`${LEAST * ROW}px`, `${MOST * ROW}px`]);
    expect(screen.getByTestId("resources-rows").style.height).toBe(`${MOST * ROW}px`);
    expect(mounted()).toHaveLength(30);
    expect(rows()[0]).toEqual(["group-00.example/v1/Kind0", "2000 items"]);
    expect(rows()[1]).toEqual(["ns-0", "item-00000"]);
    // In the middle of the list: the rows before the room and after it, ten on each side.
    scroll(ROW * 30000 + 10);
    expect(mounted().length).toBe(MOUNTED);
    expect(mounted()[0].getAttribute("data-item")).toBe("ns-9/item-00759");
    expect(screen.queryAllByTestId("resources-kind").map((row) => row.getAttribute("data-resource"))).toEqual([
      "group-15.example/v1/Kind15",
    ]);
    // At the end, and past it: the last item is there, and the first is not.
    scroll(ROW * 60000);
    expect(mounted().length).toBeLessThanOrEqual(MOUNTED);
    expect(mounted().at(-1)?.getAttribute("data-item")).toBe("ns-9/item-01959");
    expect(rows().at(-1)).toEqual(["ns-9", "item-01959"]);
    expect(screen.queryAllByTestId("resources-kind")).toEqual([]);
  });

  it("finds one item among fifty thousand by its resource, its namespace and its name, and starts from the top of what is left", () => {
    render(<ResourcesViewer id="resources" text={LARGE} of="Backup" />);
    scroll(ROW * 30000);
    type("example");
    // Every item is left, and the list is at its top again.
    expect(count()).toBe("50000 of 50000 items, of 25 of 25 resources.");
    expect(rows()[0]).toEqual(["group-00.example/v1/Kind0", "2000 of 2000 items"]);
    expect(mounted().length).toBeLessThanOrEqual(MOUNTED);
    scroll(ROW * 30000);
    type("kind7 ns-3 item-00003");
    expect(rows()).toEqual([
      ["group-07.example/v1/Kind7", "1 of 2000 items"],
      ["ns-3", "item-00003"],
    ]);
    expect(count()).toBe("1 of 50000 items, of 1 of 25 resources.");
    // What is left has the room of its rows, and no more.
    expect(room()).toEqual([`${2 * ROW}px`, `${2 * ROW}px`]);
  });

  it("gives its rows the room the view leaves, six of them at least and twenty at most, and counts nothing on the window", () => {
    const viewer = () => <ResourcesViewer id="resources" text={LARGE} of="Backup" />;
    const { rerender } = render(viewer());
    const list = () => screen.getByTestId("resources-rows").style.height;
    // The room the view leaves the rows, which the list of the host measures when it is drawn.
    const leave = (rows: number) => {
      virtualList.room = rows * ROW;
      rerender(viewer());
    };

    // The room of the rows is between the two, whatever the list of the host measures of it.
    expect(room()).toEqual([`${LEAST * ROW}px`, `${MOST * ROW}px`]);
    expect(list()).toBe(`${MOST * ROW}px`);
    // The list of the host is given no height: it is as tall as the room it measures, and mounts the
    // rows of that room. A view that leaves the room of nine rows shows nine, and one that leaves the
    // least shows six.
    leave(9);
    expect(list()).toBe(`${9 * ROW}px`);
    expect(mounted()).toHaveLength(19);
    leave(LEAST);
    expect(list()).toBe(`${LEAST * ROW}px`);
    expect(mounted()).toHaveLength(LEAST + 10);
    // The window says nothing of the room: a window twice as tall, and one at twice the zoom, change
    // neither the bounds nor what is mounted.
    for (const height of [120, 325, 650, 4000]) {
      resize(height);
      expect([height, room(), list()]).toEqual([height, [`${LEAST * ROW}px`, `${MOST * ROW}px`], `${LEAST * ROW}px`]);
    }
    expect(mounted().length).toBeLessThanOrEqual(MOUNTED);
    cleanup();
    // A list of fewer rows than the least has the room of its rows, and no more.
    render(
      <ResourcesViewer id="resources" text={JSON.stringify({ "v1/Pod": ["shop/cart", "shop/pay"] })} of="Backup" />,
    );
    expect(room()).toEqual([`${3 * ROW}px`, `${3 * ROW}px`]);
  });

  it("puts the part that is scrolled in the order of the Tab key, with a name", () => {
    render(<ResourcesViewer id="resources" text={LARGE} of="Backup" />);
    const list = screen.getByRole("group", { name: "The resources and their items" });

    expect(list).toBe(screen.getByTestId("resources-rows"));
    expect(list.tabIndex).toBe(0);
    // The list that takes its place when the filter changes is reached the same way.
    type("kind7");
    expect(screen.getByRole("group", { name: "The resources and their items" }).tabIndex).toBe(0);
  });
});

describe("a text that is not a resource list", () => {
  it("is shown as the text it is, with the note that its shape is not the one the extension was written for, and nothing is raised", () => {
    for (const written of [
      "",
      "not JSON",
      "[]",
      "null",
      '{"v1/Pod":"shop/cart"}',
      '{"v1/Pod":[1]}',
      "{".repeat(5000),
    ]) {
      const { container, unmount } = render(<ResourcesViewer id="resources" text={written} of="Restore" />);

      expect(lines.given.at(-1)).toEqual({
        id: "resources",
        text: written,
        note: "The resource list of this restore is not of the shape the extension was written for, a map from each resource to the list of its items: it is shown as the text it is.",
      });
      // Nothing of the list is shown beside it.
      expect(container.querySelectorAll("[data-lines]")).toHaveLength(1);
      expect(container.querySelector("[data-testid]")).toBeNull();
      unmount();
    }
    render(<ResourcesViewer id="resources" text="[]" of="Backup" />);
    expect(lines.given.at(-1)?.note).toContain("The resource list of this backup is not of the shape");
  });
});
