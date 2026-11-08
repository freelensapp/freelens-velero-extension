import { describe, expect, it } from "vitest";
import { keptEndWords } from "./kept-end-words";

import type { KeptEnd } from "./ipc";

const end: KeptEnd = {
  request: "00000000-0000-4000-8000-0000000000aa",
  kind: "backup-from-schedule",
  namespace: "velero",
  context: "kind-demo",
  name: "nightly-20261108043015",
  schedule: "nightly",
  outcome: { created: true, phase: "Completed" },
  at: 1,
};

describe("what the target bar says of an end no view showed", () => {
  it("says what to look for and where, and how it ended, whole", () => {
    expect(keptEndWords(end)).toBe(
      "The backup nightly-20261108043015, asked from the schedule nightly in velero (context kind-demo), was created while no view of it was open. Velero wrote its phase: Completed.",
    );
    expect(keptEndWords({ ...end, outcome: { created: true, found: true } })).toBe(
      "The backup nightly-20261108043015, asked from the schedule nightly in velero (context kind-demo), was created while no view of it was open, found by its name after the answer of its creation was lost. Velero had not read it yet.",
    );
    expect(
      keptEndWords({
        ...end,
        outcome: { created: false, code: "conflict", text: "A backup named nightly-20261108043015 is already there." },
      }),
    ).toBe(
      "The backup nightly-20261108043015, asked from the schedule nightly in velero (context kind-demo), ended while no view of it was open: A backup named nightly-20261108043015 is already there.",
    );
  });
});
