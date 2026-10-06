// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { otherShape } from "../../common/artifact-volumes";
import { CONTENT } from "./artifact-viewer";
import { time } from "./status";
import { VolumesViewer } from "./volumes-viewer";

// The lines of a text are of another slice: what is under test is what the viewer gives them.
const lines = vi.hoisted(() => ({ given: [] as { id: string; text: string; note?: string }[] }));

vi.mock("./artifact-lines", () => ({
  ArtifactLines: (props: { id: string; text: string; note?: string }) => {
    lines.given.push(props);
    return <div data-lines={props.id} />;
  },
}));

const ID = "velero-backup-volumes";

// Entries as the reviewed release writes them: one of each method, and a volume it skipped.
const NATIVE = {
  pvcName: "data",
  pvcNamespace: "shop",
  pvName: "pv-1",
  backupMethod: "NativeSnapshot",
  snapshotDataMoved: false,
  preserveLocalSnapshot: false,
  skipped: false,
  startTimestamp: "2026-10-04T10:00:00Z",
  completionTimestamp: "2026-10-04T10:01:00Z",
  result: "succeeded",
  nativeSnapshotInfo: {
    snapshotHandle: "snap-1",
    volumeType: "gp3",
    volumeAZ: "eu-west-1a",
    iops: "3000",
    Phase: "Completed",
  },
  pvInfo: { reclaimPolicy: "Delete", labels: { tier: "data", zone: "a" } },
};
const POD = {
  pvcName: "cache",
  pvcNamespace: "shop",
  pvName: "pv-2",
  backupMethod: "PodVolumeBackup",
  snapshotDataMoved: false,
  preserveLocalSnapshot: false,
  skipped: false,
  result: "failed",
  pvbInfo: {
    snapshotHandle: "",
    size: 2048,
    uploaderType: "kopia",
    volumeName: "cache",
    podName: "cart-0",
    podNamespace: "shop",
    nodeName: "node-1",
    Phase: "Failed",
  },
};
const SNAPSHOT = {
  pvcName: "orders",
  pvcNamespace: "shop",
  pvName: "pv-3",
  backupMethod: "CSISnapshot",
  snapshotDataMoved: false,
  preserveLocalSnapshot: false,
  skipped: false,
  result: "succeeded",
  csiSnapshotInfo: {
    snapshotHandle: "csi-0",
    size: 1073741824,
    driver: "ebs.csi.aws.com",
    vscName: "vsc-0",
    ReadyToUse: true,
  },
};
const MOVED = {
  pvcName: "ledger",
  pvcNamespace: "billing",
  pvName: "pv-4",
  backupMethod: "CSISnapshot",
  snapshotDataMoved: true,
  preserveLocalSnapshot: true,
  skipped: false,
  result: "succeeded",
  csiSnapshotInfo: {
    snapshotHandle: "csi-1",
    size: 1073741824,
    driver: "ebs.csi.aws.com",
    vscName: "vsc-1",
    ReadyToUse: true,
  },
  snapshotDataMovementInfo: {
    dataMover: "velero",
    uploaderType: "kopia",
    retainedSnapshot: "csi-1",
    snapshotHandle: "moved-1",
    operationID: "du-1",
    size: 524288,
    Phase: "Completed",
  },
};
const SKIPPED = {
  pvName: "pv-5",
  snapshotDataMoved: false,
  preserveLocalSnapshot: false,
  skipped: true,
  skippedReason: "CSI: skipped since PV is not bound to a PVC",
};
const ALL = [NATIVE, POD, SNAPSHOT, MOVED, SKIPPED];
const RESTORED = [
  {
    pvcName: "cache",
    pvcNamespace: "shop",
    pvName: "pv-9",
    restoreMethod: "PodVolumeRestore",
    snapshotDataMoved: false,
    pvrInfo: {
      snapshotHandle: "kopia-1",
      size: 4096,
      uploaderType: "kopia",
      volumeName: "cache",
      podName: "cart-0",
      podNamespace: "shop",
    },
  },
  { pvcName: "data", pvcNamespace: "shop", restoreMethod: "CSISnapshot", snapshotDataMoved: true },
];

function Shown({ entries, of = "Backup" }: { entries: unknown; of?: "Backup" | "Restore" }) {
  return <VolumesViewer id={ID} text={typeof entries === "string" ? entries : JSON.stringify(entries)} of={of} />;
}

const root = () => screen.getByTestId(ID);
const rows = () => [...root().querySelectorAll<HTMLElement>("[data-volume-row]")];
const cell = (row: number, column: string) =>
  rows()[row].querySelector<HTMLElement>(`[data-column=${column}]`) as HTMLElement;
// The words of a part, without its icons: the host draws an icon from the text of its name.
function words(element: Element | null | undefined): string | undefined {
  const read = element?.cloneNode(true) as Element | undefined;

  for (const icon of read?.querySelectorAll(".Icon") ?? []) icon.remove();
  return read?.textContent ?? undefined;
}
// What a column says of every row, and what a part of a cell says.
const column = (name: string) => rows().map((_row, index) => words(cell(index, name)));
const part = (row: number, name: string, mark: string) => words(cell(row, name).querySelector(`[${mark}]`));
const heads = () => [...root().querySelectorAll("[role=columnheader]")].map((head) => head.textContent);
const toggle = (row: number) => screen.getByTestId(`${ID}-toggle-${row}`);
const details = (row: number) => screen.queryByTestId(`${ID}-details-${row}`);
// The details of a row as they are shown: each title with its fields, each by its name.
const fields = (row: number) =>
  Object.fromEntries(
    [...(details(row)?.querySelectorAll("[data-detail]") ?? [])].map((detail) => [
      detail.querySelector("h4")?.textContent,
      [...detail.querySelectorAll("[data-field]")].map((field) => [
        field.querySelector("dt")?.textContent,
        field.querySelector("dd")?.textContent,
      ]),
    ]),
  );

afterEach(() => {
  cleanup();
  lines.given.length = 0;
  vi.restoreAllMocks();
});

describe("the volumes of an operation", () => {
  it("shows one row for each volume of a backup, in a table of the host that says what each column is", () => {
    render(<Shown entries={ALL} />);
    const table = screen.getByRole("table");

    expect(table.getAttribute("aria-label")).toBe("Volumes of the backup");
    expect(root().contains(table)).toBe(true);
    expect(table.querySelectorAll(".Table .TableHead")).toHaveLength(1);
    // The table is scrolled in its own room, not by the host, and its columns have the room of their words.
    expect(table.querySelector(".Table")?.className).toBe("Table flex column");
    expect(heads()).toEqual([
      "Details",
      "Claim",
      "Volume",
      "Method",
      "Result",
      "Data moved",
      "Local snapshot kept",
      "Skipped",
      "Started",
      "Ended",
      "Size",
    ]);
    expect(rows()).toHaveLength(5);
    // The head is a row, and each row has a cell for each column.
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    for (const row of rows()) expect(within(row).getAllByRole("cell")).toHaveLength(11);
    expect(root().getAttribute("data-count")).toBe("5");
    expect(part(0, "claim", "data-claim")).toBe("data");
    expect(part(0, "claim", "data-namespace")).toBe("in shop");
    expect(column("volume")).toEqual(["pv-1", "pv-2", "pv-3", "pv-4", "pv-5"]);
    expect(column("method")).toEqual(["NativeSnapshot", "PodVolumeBackup", "CSISnapshot", "CSISnapshot", "Not stated"]);
    expect(column("result")).toEqual(["succeeded", "failed", "succeeded", "succeeded", "Not stated"]);
    // How a volume ended is said by its word, and by a mark beside it that is not read twice.
    expect(cell(0, "result").querySelector("[data-result]")?.getAttribute("data-result")).toBe("succeeded");
    expect(cell(1, "result").querySelector("[data-result]")?.getAttribute("data-result")).toBe("failed");
    expect(cell(1, "result").querySelector(".Icon")?.getAttribute("aria-hidden")).toBe("true");
    // The mark of a volume that failed is the one of a failure, and the one of what ended well is another.
    expect([0, 1].map((row) => cell(row, "result").querySelector(".Icon")?.textContent)).toEqual([
      "check",
      "error_outline",
    ]);
    expect(column("moved")).toEqual(["No", "No", "No", "Yes", "No"]);
    // Every identifier the viewer gives is under the one it was given.
    for (const marked of root().querySelectorAll("[data-testid]"))
      expect(marked.getAttribute("data-testid")?.startsWith(`${ID}-`)).toBe(true);
  });

  it("shows the size read from the detail of each method, in a unit that reads well, with its bytes", () => {
    render(<Shown entries={ALL} />);
    // A native snapshot carries no size; a snapshot whose data was moved, the one of what was moved.
    expect(column("size")).toEqual(["Not stated", "2.0 KiB", "1.0 GiB", "512.0 KiB", "Not stated"]);
    expect(cell(1, "size").querySelector("[title]")?.getAttribute("title")).toBe("2048 bytes");
    expect(cell(3, "size").querySelector("[title]")?.getAttribute("title")).toBe("524288 bytes");
    expect(cell(0, "size").querySelector("[title]")).toBeNull();
  });

  it("shows the start and the end as the views show a time, and a text that is not a time as it is written", () => {
    render(<Shown entries={[NATIVE, { ...NATIVE, startTimestamp: "yesterday", completionTimestamp: "10:01" }, POD]} />);
    expect(column("started")).toEqual([time(Date.parse("2026-10-04T10:00:00Z")), "yesterday", "Not stated"]);
    expect(column("ended")).toEqual([time(Date.parse("2026-10-04T10:01:00Z")), "10:01", "Not stated"]);
    // The time as it is written is what is read by who points at it.
    expect(cell(0, "started").querySelector("[title]")?.getAttribute("title")).toBe("2026-10-04T10:00:00Z");
    expect(cell(1, "started").querySelector("[title]")).toBeNull();
  });

  it("says that a volume was skipped and why, and that a local snapshot was kept", () => {
    // The last is a snapshot whose data was moved, and which was not kept where it was taken.
    render(
      <Shown
        entries={[...ALL, { ...SKIPPED, skippedReason: undefined }, { ...MOVED, preserveLocalSnapshot: false }]}
      />,
    );
    expect(rows().map((_row, index) => part(index, "skipped", "data-skipped"))).toEqual([
      "No",
      "No",
      "No",
      "No",
      "Yes",
      "Yes",
      "No",
    ]);
    expect(part(4, "skipped", "data-reason")).toBe("CSI: skipped since PV is not bound to a PVC");
    // A volume that was not skipped has no reason, and one that was skipped for none says so.
    expect(part(0, "skipped", "data-reason")).toBeUndefined();
    expect(part(5, "skipped", "data-reason")).toBe("No reason stated");
    expect(column("kept")).toEqual(["No", "No", "No", "Yes", "No", "No", "No"]);
    expect(column("moved")).toEqual(["No", "No", "No", "Yes", "No", "No", "Yes"]);
    // A volume that was skipped has no claim, no method, no result and no time, which is said.
    expect(part(4, "claim", "data-claim")).toBe("Not stated");
    expect(part(4, "claim", "data-namespace")).toBeUndefined();
    for (const name of ["method", "result", "started", "ended", "size"]) expect(column(name)[4]).toBe("Not stated");
  });

  it("leaves no cell empty: what an entry does not say is said as not stated, and never as a no", () => {
    render(<Shown entries={[{}, { pvcName: "data" }, { pvcNamespace: "shop" }]} />);
    for (const name of ["volume", "method", "result", "moved", "kept", "skipped", "started", "ended", "size"])
      expect([name, column(name)]).toEqual([name, ["Not stated", "Not stated", "Not stated"]]);
    expect(rows().map((_row, index) => part(index, "claim", "data-claim"))).toEqual([
      "Not stated",
      "data",
      "Not stated",
    ]);
    expect(rows().map((_row, index) => part(index, "claim", "data-namespace"))).toEqual([
      undefined,
      "Namespace not stated",
      "in shop",
    ]);
    // The cells of the host show a title in place of what they hold: none is given one.
    for (const shown of root().querySelectorAll(".TableCell")) expect(shown.getAttribute("title")).toBeNull();
    for (const shown of root().querySelectorAll("[data-column]")) expect(words(shown)).not.toBe("");
  });

  it("opens the details of a row under it and closes them, by a command that says whether they are open", () => {
    render(<Shown entries={ALL} />);
    const command = toggle(3);

    expect(command.tagName).toBe("BUTTON");
    expect(command.getAttribute("type")).toBe("button");
    expect(command.getAttribute("aria-label")).toBe("Details of the volume pv-4");
    expect(command.getAttribute("title")).toBe("Details of the volume pv-4");
    expect(command.getAttribute("aria-expanded")).toBe("false");
    expect(command.getAttribute("aria-controls")).toBeNull();
    expect(rows().map((_row, index) => details(index))).toEqual([null, null, null, null, null]);
    // The command is in the order of the keyboard, which chooses a button with Enter and with Space.
    expect(command.tabIndex).toBe(0);
    command.focus();
    expect(document.activeElement).toBe(command);
    fireEvent.click(command);
    expect(command.getAttribute("aria-expanded")).toBe("true");
    expect(command.getAttribute("aria-controls")).toBe(details(3)?.id);
    expect(details(3)?.id).toBe(`${ID}-details-3`);
    // The details are a row of the table, the one after their own, with one cell as wide as the table.
    expect(details(3)?.parentElement).toBe(rows()[3].nextElementSibling);
    expect(details(3)?.parentElement?.className).toContain("TableRow");
    expect(details(3)?.parentElement?.getAttribute("role")).toBe("row");
    expect(details(3)?.getAttribute("role")).toBe("cell");
    expect(details(3)?.getAttribute("aria-colspan")).toBe("11");
    // The focus stays on the command, and the other rows stay closed.
    expect(document.activeElement).toBe(command);
    expect(rows().map((_row, index) => toggle(index).getAttribute("aria-expanded"))).toEqual([
      "false",
      "false",
      "false",
      "true",
      "false",
    ]);
    // A second row opens beside the first, and each closes alone.
    fireEvent.click(toggle(0));
    expect(details(0)).not.toBeNull();
    expect(details(3)).not.toBeNull();
    for (const marked of root().querySelectorAll("[data-testid]"))
      expect(marked.getAttribute("data-testid")?.startsWith(`${ID}-`)).toBe(true);
    fireEvent.click(command);
    expect(details(3)).toBeNull();
    expect(details(0)).not.toBeNull();
    expect(command.getAttribute("aria-expanded")).toBe("false");
    expect(command.getAttribute("aria-controls")).toBeNull();
  });

  it("shows the details of the four methods, each field by its name, the ones written without a JSON name too", () => {
    render(<Shown entries={ALL} />);
    for (const index of [0, 1, 2, 3]) fireEvent.click(toggle(index));
    expect(fields(0)).toEqual({
      "Native snapshot": [
        ["snapshotHandle", "snap-1"],
        ["volumeType", "gp3"],
        ["volumeAZ", "eu-west-1a"],
        ["iops", "3000"],
        ["Phase", "Completed"],
      ],
      Volume: [
        ["reclaimPolicy", "Delete"],
        ["labels", "tier=data, zone=a"],
      ],
    });
    expect(fields(1)).toEqual({
      "Pod volume backup": [
        // A field that is written empty says so.
        ["snapshotHandle", "Empty"],
        ["size", "2048"],
        ["uploaderType", "kopia"],
        ["volumeName", "cache"],
        ["podName", "cart-0"],
        ["podNamespace", "shop"],
        ["nodeName", "node-1"],
        ["Phase", "Failed"],
      ],
    });
    expect(fields(2)).toEqual({
      "CSI snapshot": [
        ["snapshotHandle", "csi-0"],
        ["size", "1073741824"],
        ["driver", "ebs.csi.aws.com"],
        ["vscName", "vsc-0"],
        ["ReadyToUse", "true"],
      ],
    });
    expect(Object.keys(fields(3))).toEqual(["CSI snapshot", "Data movement"]);
    expect(fields(3)["Data movement"]).toEqual([
      ["dataMover", "velero"],
      ["uploaderType", "kopia"],
      ["retainedSnapshot", "csi-1"],
      ["snapshotHandle", "moved-1"],
      ["operationID", "du-1"],
      ["size", "524288"],
      ["Phase", "Completed"],
    ]);
    // The name of a field is shown as it is written, in its capitals.
    const named = details(3)?.querySelector("[data-field=ReadyToUse] dt") as HTMLElement;

    expect(named.textContent).toBe("ReadyToUse");
    expect(named.className).not.toContain("factName");
  });

  it("says that the entry of a volume carries no details, and that a detail is written with no field", () => {
    render(<Shown entries={[SKIPPED, { ...NATIVE, nativeSnapshotInfo: {}, pvInfo: undefined }]} />);
    fireEvent.click(toggle(0));
    fireEvent.click(toggle(1));
    expect(details(0)?.textContent).toBe("The entry of this volume carries no details.");
    expect(fields(0)).toEqual({});
    expect(fields(1)).toEqual({ "Native snapshot": [] });
    expect(details(1)?.querySelector("[data-detail=nativeSnapshotInfo] p")?.textContent).toBe(
      "It is written with no field.",
    );
    expect(details(1)?.textContent).not.toContain("carries no details");
  });

  it("keeps the text of a method and of a result the release does not write, with the mark in words", () => {
    render(<Shown entries={[{ ...NATIVE, backupMethod: "FileSystemClone", result: "partial" }, NATIVE]} />);
    expect(part(0, "method", "data-text")).toBe("FileSystemClone");
    expect(part(0, "method", "data-mark")).toBe("Not a method of the reviewed release");
    expect(cell(0, "method").querySelector("[data-known]")?.getAttribute("data-known")).toBe("false");
    expect(part(0, "result", "data-text")).toBe("partial");
    expect(part(0, "result", "data-mark")).toBe("Not a result of the reviewed release");
    expect(cell(0, "result").querySelector("[data-known]")?.getAttribute("data-known")).toBe("false");
    // The mark is words that are read, beside an icon that is not: not a color alone.
    expect(cell(0, "method").querySelector("[data-mark] .Icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(cell(0, "result").querySelector("[data-result]")).toBeNull();
    // A method and a result of the release have no mark.
    expect(part(1, "method", "data-mark")).toBeUndefined();
    expect(part(1, "result", "data-mark")).toBeUndefined();
    expect(cell(1, "method").querySelector("[data-known]")?.getAttribute("data-known")).toBe("true");
    expect(words(cell(1, "method"))).toBe("NativeSnapshot");
    // A method is the word it is: it is not how a volume ended, and has neither its mark nor its look.
    expect(cell(1, "method").querySelector("[data-result]")).toBeNull();
    expect(cell(1, "method").querySelector(".Icon")).toBeNull();
    expect(cell(1, "method").querySelector("[data-known]")?.className).toBe("");
    expect(cell(1, "result").querySelector("[data-result] .Icon")?.textContent).toBe("check");
  });

  it("shows by its name and its value a field the tab does not know, of an entry and of a detail", () => {
    render(
      <Shown
        entries={[
          {
            ...NATIVE,
            encryption: "aws:kms",
            attempts: 2,
            nativeSnapshotInfo: { ...NATIVE.nativeSnapshotInfo, encrypted: true },
          },
          { encryption: "none" },
        ]}
      />,
    );
    fireEvent.click(toggle(0));
    fireEvent.click(toggle(1));
    expect(Object.keys(fields(0))).toEqual(["Native snapshot", "Volume", "Other fields of the entry"]);
    expect(fields(0)["Other fields of the entry"]).toEqual([
      ["encryption", "aws:kms"],
      ["attempts", "2"],
    ]);
    expect(fields(0)["Native snapshot"]).toContainEqual(["encrypted", "true"]);
    // An entry of nothing but a field the tab does not know has that field for its details.
    expect(fields(1)).toEqual({ "Other fields of the entry": [["encryption", "none"]] });
    expect(details(1)?.textContent).not.toContain("carries no details");
  });

  it("shows the volumes of a restore: the way each was restored, and none of what only a backup says", () => {
    render(<Shown entries={RESTORED} of="Restore" />);
    expect(screen.getByRole("table").getAttribute("aria-label")).toBe("Volumes of the restore");
    expect(screen.getByRole("table").getAttribute("data-of")).toBe("Restore");
    expect(heads()).toEqual(["Details", "Claim", "Volume", "Method", "Data moved", "Size"]);
    expect(column("method")).toEqual(["PodVolumeRestore", "CSISnapshot"]);
    expect(column("volume")).toEqual(["pv-9", "Not stated"]);
    expect(column("moved")).toEqual(["No", "Yes"]);
    expect(column("size")).toEqual(["4.0 KiB", "Not stated"]);
    expect(screen.getByTestId(`${ID}-count`).textContent).toBe("Velero recorded 2 volumes for this restore.");
    expect(toggle(1).getAttribute("aria-label")).toBe("Details of the volume of the claim shop/data");
    fireEvent.click(toggle(0));
    expect(details(0)?.getAttribute("aria-colspan")).toBe("6");
    expect(Object.keys(fields(0))).toEqual(["Pod volume restore"]);
    expect(fields(0)["Pod volume restore"]).toContainEqual(["size", "4096"]);
    // The method of a backup is not one of a restore: it keeps its text, with the mark.
    cleanup();
    render(<Shown entries={[{ restoreMethod: "PodVolumeBackup", snapshotDataMoved: false }]} of="Restore" />);
    expect(part(0, "method", "data-text")).toBe("PodVolumeBackup");
    expect(part(0, "method", "data-mark")).toBe("Not a method of the reviewed release");
  });

  it("says that Velero recorded no volume, for a backup and for a restore, and shows no table", () => {
    for (const of of ["Backup", "Restore"] as const) {
      render(<Shown entries="[]" of={of} />);
      const none = screen.getByTestId(`${ID}-none`);

      expect(none.textContent).toBe(`Velero recorded no volume for this ${of.toLowerCase()}.`);
      expect(root().getAttribute("data-count")).toBe("0");
      expect(screen.queryByRole("table")).toBeNull();
      // The sentence is what the content begins with: it is what is given the focus.
      expect(root().querySelectorAll(`[${CONTENT}]`)).toHaveLength(1);
      expect(none.hasAttribute(CONTENT)).toBe(true);
      expect(none.tabIndex).toBe(-1);
      expect(lines.given).toEqual([]);
      cleanup();
    }
  });

  it("begins with how many volumes there are, in a part that can be given the focus and is not reached by Tab", () => {
    render(<Shown entries={ALL} />);
    const count = screen.getByTestId(`${ID}-count`);

    expect(count.textContent).toBe("Velero recorded 5 volumes for this backup.");
    expect(root().firstElementChild).toBe(count);
    expect(root().querySelectorAll(`[${CONTENT}]`)).toHaveLength(1);
    expect(count.hasAttribute(CONTENT)).toBe(true);
    expect(count.tabIndex).toBe(-1);
    count.focus();
    expect(document.activeElement).toBe(count);
    cleanup();
    render(<Shown entries={[POD]} />);
    expect(screen.getByTestId(`${ID}-count`).textContent).toBe("Velero recorded 1 volume for this backup.");
  });

  it("shows a text of another shape as the text it is, with the note of its shape, and raises nothing", () => {
    for (const of of ["Backup", "Restore"] as const)
      for (const text of [
        "",
        "not JSON",
        "{}",
        "null",
        '{"volumes":[]}',
        '[{"pvcName":3}]',
        '[{"csiSnapshotInfo":"csi-1"}]',
        // A value the runtime reads and cannot write back as the text of a field: lists nested deep.
        `[{"pvName":"pv-1","extra":{"0":${"[".repeat(200_000)}${"]".repeat(200_000)}}}]`,
      ]) {
        const { container } = render(<Shown entries={text} of={of} />);

        expect([text, lines.given]).toEqual([text, [{ id: ID, text, note: otherShape(of) }]]);
        // Nothing but the lines is shown: no table, and no sentence that there is no volume.
        expect(container.querySelectorAll("[data-lines]")).toHaveLength(1);
        expect(container.firstElementChild?.getAttribute("data-lines")).toBe(ID);
        expect(container.textContent).toBe("");
        cleanup();
        lines.given.length = 0;
      }
  });

  it("parses a text once, however many times it is drawn, and again for another text or another kind", () => {
    const parsed = vi.spyOn(JSON, "parse");
    const text = JSON.stringify(ALL);
    const times = (given: string) => parsed.mock.calls.filter(([asked]) => asked === given).length;
    const { rerender } = render(<VolumesViewer id={ID} text={text} of="Backup" />);

    fireEvent.click(toggle(0));
    fireEvent.click(toggle(1));
    fireEvent.click(toggle(0));
    rerender(<VolumesViewer id={ID} text={text} of="Backup" />);
    expect(times(text)).toBe(1);
    const other = JSON.stringify([POD]);

    rerender(<VolumesViewer id={ID} text={other} of="Backup" />);
    rerender(<VolumesViewer id={ID} text={other} of="Backup" />);
    expect([times(text), times(other)]).toEqual([1, 1]);
    rerender(<VolumesViewer id={ID} text={other} of="Restore" />);
    expect(times(other)).toBe(2);
  });

  it("closes every row when another text is shown: the rows that were open were of the one before", () => {
    const { rerender } = render(<Shown entries={ALL} />);

    fireEvent.click(toggle(0));
    fireEvent.click(toggle(2));
    expect(root().querySelectorAll("[data-volume-details]")).toHaveLength(2);
    rerender(<Shown entries={[POD, NATIVE, SNAPSHOT]} />);
    expect(rows()).toHaveLength(3);
    expect(root().querySelectorAll("[data-volume-details]")).toHaveLength(0);
    expect(rows().map((_row, index) => toggle(index).getAttribute("aria-expanded"))).toEqual([
      "false",
      "false",
      "false",
    ]);
    // A row that is opened after it is of the text that is shown.
    fireEvent.click(toggle(0));
    expect(Object.keys(fields(0))).toEqual(["Pod volume backup"]);
  });
});
