import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGE_BOUND, readArtifactPage } from "../common/ipc";
import { ArtifactHolder, HELD_BYTES, HELD_TEXTS, HOLD_MS, pageOffsets } from "./artifact-holder";

afterEach(() => {
  vi.useRealTimers();
});

// Every page of a text, as the frame it is held for is given them.
function pages(holder: ArtifactHolder, request: string, sender = "frame-1"): string[] {
  const read: string[] = [];

  for (let page = 0; ; page += 1) {
    const found = holder.page("cluster-a", sender, request, page);

    if (!found) break;
    read.push(found.text);
  }
  return read;
}

describe("the pages of a text", () => {
  it("are of a page of bytes at most, and none ends inside a character", () => {
    // Characters of one, two, three and four bytes, in a page too short for a whole number of them.
    const text = "aé€😀".repeat(40);
    const content = Buffer.from(text, "utf8");

    for (const bound of [4, 5, 7, 11, 64]) {
      const offsets = pageOffsets(content, bound);
      const parts = offsets.slice(1).map((end, index) => content.toString("utf8", offsets[index], end));

      expect([bound, parts.join("")]).toEqual([bound, text]);
      expect([bound, parts.every((part) => !part.includes("�"))]).toEqual([bound, true]);
      expect([bound, offsets.slice(1).every((end, index) => end - offsets[index] <= bound)]).toEqual([bound, true]);
      expect([bound, offsets.slice(1).every((end, index) => end > offsets[index])]).toEqual([bound, true]);
    }
  });

  it("are one for a text that fits a page, none for no text, and as many as it takes for a text of the largest size", () => {
    expect(pageOffsets(Buffer.alloc(0))).toEqual([0]);
    expect(pageOffsets(Buffer.from("log"))).toEqual([0, 3]);
    expect(pageOffsets(Buffer.alloc(PAGE_BOUND, "x"))).toEqual([0, PAGE_BOUND]);
    expect(pageOffsets(Buffer.alloc(PAGE_BOUND + 1, "x"))).toEqual([0, PAGE_BOUND, PAGE_BOUND + 1]);
    // 64 MiB, the most a download decodes: sixteen pages.
    expect(pageOffsets(Buffer.alloc(64 * 1024 ** 2, "x"))).toHaveLength(17);
  });

  it("cut bytes that are not a text where a page ends, and stop", () => {
    const offsets = pageOffsets(Buffer.alloc(20, 0x80), 8);

    expect(offsets).toEqual([0, 8, 16, 20]);
  });
});

describe("the text of an artifact, held by the main process", () => {
  it("is given page by page to the frame it is held for, each page one the views read", () => {
    const holder = new ArtifactHolder();
    const text = `${"a".repeat(PAGE_BOUND - 1)}€${"b".repeat(10)}`;

    expect(holder.hold("cluster-a", "frame-1", "request-1", Buffer.from(text))).toEqual({
      size: PAGE_BOUND + 2 + 10,
      pages: 2,
    });
    const first = holder.page("cluster-a", "frame-1", "request-1", 0);
    const second = holder.page("cluster-a", "frame-1", "request-1", 1);

    // The character that does not fit the first page whole begins the second.
    expect(first?.text).toBe("a".repeat(PAGE_BOUND - 1));
    expect(second?.text).toBe(`€${"b".repeat(10)}`);
    expect(readArtifactPage(first)).toEqual(first);
    expect(readArtifactPage(second)).toEqual({ page: 1, pages: 2, text: second?.text });
    expect(holder.page("cluster-a", "frame-1", "request-1", 2)).toBeUndefined();
    expect(holder.page("cluster-a", "frame-1", "request-1", -1)).toBeUndefined();
    expect(holder.page("cluster-a", "frame-1", "request-1", 0.5)).toBeUndefined();
    holder.dispose();
  });

  it("is given to no other frame, and to no other cluster, and is let go by the frame it is held for alone", () => {
    const holder = new ArtifactHolder();

    holder.hold("cluster-a", "frame-1", "request-1", Buffer.from("synthetic log"));
    expect(pages(holder, "request-1", "frame-2")).toEqual([]);
    expect(holder.page("cluster-b", "frame-1", "request-1", 0)).toBeUndefined();
    expect(holder.page("cluster-a", "frame-1", "request-2", 0)).toBeUndefined();
    expect(holder.release("cluster-a", "frame-2", "request-1")).toBe(false);
    expect(holder.release("cluster-b", "frame-1", "request-1")).toBe(false);
    expect(pages(holder, "request-1")).toEqual(["synthetic log"]);
    expect(holder.release("cluster-a", "frame-1", "request-1")).toBe(true);
    expect(pages(holder, "request-1")).toEqual([]);
    expect(holder.release("cluster-a", "frame-1", "request-1")).toBe(false);
    expect(holder.size).toBe(0);
  });

  it("holds a text of no byte, which has no page", () => {
    const holder = new ArtifactHolder();

    expect(holder.hold("cluster-a", "frame-1", "request-1", Buffer.alloc(0))).toEqual({ size: 0, pages: 0 });
    expect(holder.page("cluster-a", "frame-1", "request-1", 0)).toBeUndefined();
    expect(holder.release("cluster-a", "frame-1", "request-1")).toBe(true);
  });

  it("lets a text go after ten minutes, when no view did", () => {
    vi.useFakeTimers();
    const holder = new ArtifactHolder();

    holder.hold("cluster-a", "frame-1", "request-1", Buffer.from("synthetic log"));
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(pages(holder, "request-1")).toEqual(["synthetic log"]);
    vi.advanceTimersByTime(1);
    expect(pages(holder, "request-1")).toEqual([]);
    expect(holder.size).toBe(0);
    expect(HOLD_MS).toBe(600_000);
  });

  it("lets every text of a cluster go with the cluster, and every text when it is disposed", () => {
    const holder = new ArtifactHolder();

    holder.hold("cluster-a", "frame-1", "request-1", Buffer.from("one"));
    holder.hold("cluster-a", "frame-1", "request-2", Buffer.from("two"));
    holder.hold("cluster-b", "frame-9", "request-3", Buffer.from("three"));
    holder.drop("cluster-a");
    expect(pages(holder, "request-1")).toEqual([]);
    expect(pages(holder, "request-2")).toEqual([]);
    expect(holder.page("cluster-b", "frame-9", "request-3", 0)?.text).toBe("three");
    holder.dispose();
    expect(holder.size).toBe(0);
  });

  it("holds as many texts and as many bytes as its bounds, and lets the oldest go for room", () => {
    const holder = new ArtifactHolder(HOLD_MS, { texts: 3, bytes: 10 });

    holder.hold("cluster-a", "frame-1", "request-1", Buffer.from("1111"));
    holder.hold("cluster-a", "frame-1", "request-2", Buffer.from("2222"));
    // A third would be beyond the bytes: the first goes.
    holder.hold("cluster-a", "frame-1", "request-3", Buffer.from("3333"));
    expect([pages(holder, "request-1"), pages(holder, "request-2"), pages(holder, "request-3")]).toEqual([
      [],
      ["2222"],
      ["3333"],
    ]);
    holder.release("cluster-a", "frame-1", "request-3");
    holder.hold("cluster-a", "frame-1", "request-4", Buffer.from("4"));
    holder.hold("cluster-a", "frame-1", "request-5", Buffer.from("5"));
    // Three texts are held: the fourth lets the oldest go, whatever it weighs.
    holder.hold("cluster-a", "frame-1", "request-6", Buffer.from("6"));
    expect(holder.size).toBe(3);
    expect(pages(holder, "request-2")).toEqual([]);
    expect(pages(holder, "request-6")).toEqual(["6"]);
    // A text is held again under its identifier: it is one, not two.
    holder.hold("cluster-a", "frame-1", "request-6", Buffer.from("six"));
    expect(holder.size).toBe(3);
    expect(pages(holder, "request-6")).toEqual(["six"]);
    holder.dispose();
    expect([HELD_TEXTS, HELD_BYTES]).toEqual([16, 128 * 1024 ** 2]);
  });
});
