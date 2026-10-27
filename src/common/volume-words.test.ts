import { describe, expect, it } from "vitest";
import { read } from "../../test/volume-builders";
import { unavailable } from "./references";
import { VIEWS } from "./views";
import { LIST_WORDS, REFERENCE_WORDS, WORKSPACE_WORDS } from "./volume-words";

import type { ReadStatus } from "./read-state";
import type { ReferenceKind } from "./references";
import type { ViewKind } from "./views";

// The three kinds of this slice, each with the kind it is referred to by.
const KINDS: [ViewKind, ReferenceKind][] = [
  ["backup-repository", "BackupRepository"],
  ["pod-volume-backup", "PodVolumeBackup"],
  ["pod-volume-restore", "PodVolumeRestore"],
];

describe.each(KINDS)("the words of the states of the %s", (kind, referenceKind) => {
  const { noun, plural } = VIEWS[kind];

  it("are said by a list, with its plural", () => {
    expect([
      LIST_WORDS.notCounted,
      LIST_WORDS.empty(noun, "velero", "local-demo"),
      LIST_WORDS.denied(plural),
      LIST_WORDS["not-served"](plural),
      LIST_WORDS.failed(plural),
    ]).toEqual([
      "Not read yet",
      `No ${noun} is in the namespace velero of local-demo.`,
      `Access to the ${plural} of this namespace is denied. How many there are is not known.`,
      `This cluster does not serve the ${plural} of Velero.`,
      `The ${plural} of this namespace could not be read. How many there are is not known.`,
    ]);
  });

  it("are said by a view of one object", () => {
    expect([
      WORKSPACE_WORDS.missing(noun, "velero"),
      WORKSPACE_WORDS.denied(plural, "velero") + WORKSPACE_WORDS.unknownAfter,
      WORKSPACE_WORDS.stale(plural),
    ]).toEqual([
      `No ${noun} of this name is in velero. It may have been deleted, or it is of another installation.`,
      `Access to the ${plural} of velero is denied, so this one cannot be shown. It is not known to be absent.`,
      `The ${plural} could not be read again: this is what was read at`,
    ]);
  });

  it("are said by a reference to one, each state its own", () => {
    const reason = (status: ReadStatus) => unavailable(referenceKind, read([], status));

    expect([reason("idle"), reason("loading"), reason("forbidden"), reason("not-served"), reason("failed")]).toEqual([
      { state: "not-read", reason: REFERENCE_WORDS["not-read"](plural) },
      { state: "not-read", reason: REFERENCE_WORDS["not-read"](plural) },
      { state: "inaccessible", reason: REFERENCE_WORDS.denied(plural) },
      { state: "unknown", reason: REFERENCE_WORDS["not-served"](plural) },
      { state: "unknown", reason: REFERENCE_WORDS.failed(plural) },
    ]);
    expect(new Set([REFERENCE_WORDS.absent(noun, "velero"), REFERENCE_WORDS.stale(plural)]).size).toBe(2);
    expect(REFERENCE_WORDS.denied(plural)).toBe(`The ${plural} of this installation cannot be read: access is denied`);
  });
});
