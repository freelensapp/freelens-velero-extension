// The text of an artifact, held by the main process for the frame that asked for it: one copy, given to
// the views page by page, and let go when the view lets it go, after ten minutes, when the cluster of its
// frame is not what it was, or when the room is needed for another. The views hold what they show of it;
// nothing of it is kept anywhere else.

import { ARTIFACT_HOLD_MS, type ArtifactPage, PAGE_BOUND } from "../common/ipc";

// What the process holds at once: this many texts and this many bytes. The oldest is let go for room.
export const HELD_TEXTS = 16;
export const HELD_BYTES = 128 * 1024 ** 2;

interface Held {
  cluster: string;
  sender: string;
  content: Buffer;
  // The name of a file for the text, when the operator saves it, and what the dialog says is saved.
  name: string;
  title: string;
  // Whether the text was let go on purpose: by the view that held it, with its cluster, or with the
  // extension. One that outlived its time, or gave its room to another, was not.
  dropped: boolean;
  // Where each page begins, and where the last one ends.
  offsets: number[];
  timer: ReturnType<typeof setTimeout>;
}

// Where the pages of a text begin: each is a page of bytes at most, and none ends inside a character,
// which the next page would begin with half of.
export function pageOffsets(content: Buffer, bound = PAGE_BOUND): number[] {
  const offsets = [0];

  for (let at = 0; content.length - at > bound; ) {
    let end = at + bound;

    // A byte that continues a character is 10xxxxxx: the page ends before the character it is of.
    while (end > at && (content[end] & 0xc0) === 0x80) end -= 1;
    // Bytes that are not a text have no characters to keep whole.
    if (end === at) end = at + bound;
    offsets.push(end);
    at = end;
  }
  if (content.length > 0) offsets.push(content.length);
  return offsets;
}

export class ArtifactHolder {
  private readonly held = new Map<string, Held>();

  constructor(
    // For how long a text is held when no view lets it go: reading its pages, or saving it, does not
    // make it longer.
    private readonly holdMs = ARTIFACT_HOLD_MS,
    private readonly bounds = { texts: HELD_TEXTS, bytes: HELD_BYTES },
  ) {}

  private static key(cluster: string, request: string): string {
    return `${cluster}/${request}`;
  }

  private bytes(): number {
    let total = 0;

    for (const held of this.held.values()) total += held.content.length;
    return total;
  }

  // A text is let go: for the time it was held, or the room it takes, or on purpose, which is said of it
  // to a saving that is still on its way.
  private letGo(key: string, dropped = false): void {
    const held = this.held.get(key);

    if (!held) return;
    held.dropped = dropped;
    clearTimeout(held.timer);
    this.held.delete(key);
  }

  // Holds the text of a request for the frame that asked for it, and says how much there is of it.
  hold(
    cluster: string,
    sender: string,
    request: string,
    content: Buffer,
    name = "artifact.txt",
    title = "",
  ): { size: number; pages: number } {
    const key = ArtifactHolder.key(cluster, request);

    this.letGo(key);
    // Room is made by letting the oldest go: a map keeps the order its texts were held in.
    while (
      this.held.size > 0 &&
      (this.held.size >= this.bounds.texts || this.bytes() + content.length > this.bounds.bytes)
    )
      this.letGo(this.held.keys().next().value as string);
    const timer = setTimeout(() => this.letGo(key), this.holdMs);

    // The process does not stay alive for a text nobody reads.
    timer.unref?.();
    const offsets = pageOffsets(content);

    this.held.set(key, { cluster, sender, content, name, title, dropped: false, offsets, timer });
    return { size: content.length, pages: offsets.length - 1 };
  }

  // A page of a text, for the frame it is held for and for no other; nothing when it is not held, is
  // held for another, or has no such page.
  page(cluster: string, sender: string, request: string, page: number): ArtifactPage | undefined {
    const held = this.held.get(ArtifactHolder.key(cluster, request));

    if (!held || held.sender !== sender) return undefined;
    const pages = held.offsets.length - 1;

    if (!Number.isSafeInteger(page) || page < 0 || page >= pages) return undefined;
    return { page, pages, text: held.content.toString("utf8", held.offsets[page], held.offsets[page + 1]) };
  }

  // The bytes of a text, whole, with the name of a file for them and what the dialog says of them, for the
  // frame it is held for and for no other: what the operator saves. A saving takes its time, the one the
  // operator spends in the dialog: `kept` says, when it is asked, whether the text was let go on purpose
  // meanwhile, by its view, with its cluster or with the extension. Its time passing, and its room given
  // to another text, do not: the bytes are still the ones the operator asked to save.
  content(
    cluster: string,
    sender: string,
    request: string,
  ): { content: Buffer; name: string; title: string; kept(): boolean } | undefined {
    const held = this.held.get(ArtifactHolder.key(cluster, request));

    return held && held.sender === sender
      ? { content: held.content, name: held.name, title: held.title, kept: () => !held.dropped }
      : undefined;
  }

  // The view lets the text go. Only the frame it is held for can.
  release(cluster: string, sender: string, request: string): boolean {
    const key = ArtifactHolder.key(cluster, request);

    if (this.held.get(key)?.sender !== sender) return false;
    this.letGo(key, true);
    return true;
  }

  // Every text of a cluster is let go: its frame went, or its entry is not what it was.
  drop(cluster: string): void {
    for (const [key, held] of [...this.held]) if (held.cluster === cluster) this.letGo(key, true);
  }

  dispose(): void {
    for (const key of [...this.held.keys()]) this.letGo(key, true);
  }

  // How many texts are held, for the tests.
  get size(): number {
    return this.held.size;
  }
}
