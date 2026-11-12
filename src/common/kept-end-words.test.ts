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
      "The backup nightly-20261108043015, asked from the schedule nightly in velero (context kind-demo), was created while no view of it was open, found by its name after the answer of its creation was lost. Velero had written no phase of it when it was last read.",
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

  it("says the pause and the resume of a schedule, applied, read so after an answer that was lost, or not done, with what Velero does then", () => {
    const { schedule: _schedule, ...base } = { ...end, name: "nightly" };

    expect(keptEndWords({ ...base, kind: "schedule-pause", outcome: { created: true } })).toBe(
      "The pause of the schedule nightly, in velero (context kind-demo), was applied while no view of it was open: the schedule is paused, and Velero does not read it until it is resumed.",
    );
    expect(keptEndWords({ ...base, kind: "schedule-resume", outcome: { created: true } })).toBe(
      "The resume of the schedule nightly, in velero (context kind-demo), was applied while no view of it was open: the schedule is resumed, and Velero reads it at once.",
    );
    expect(keptEndWords({ ...base, kind: "schedule-pause", outcome: { created: true, found: true } })).toBe(
      "The pause of the schedule nightly, in velero (context kind-demo), was applied while no view of it was open, as the read after the answer of the patch was lost shows: the schedule is paused, and Velero does not read it until it is resumed.",
    );
    expect(
      keptEndWords({
        ...base,
        kind: "schedule-resume",
        outcome: { created: false, code: "conflict", text: "The schedule nightly changed since the review." },
      }),
    ).toBe(
      "The resume of the schedule nightly, in velero (context kind-demo), ended while no view of it was open: The schedule nightly changed since the review.",
    );
  });

  it("says a schedule of the form, and one that is paused, which Velero does not read", () => {
    const { schedule: _schedule, ...created } = { ...end, kind: "schedule" as const, name: "nightly-shop" };

    expect(keptEndWords({ ...created, outcome: { created: true, phase: "Enabled" } })).toBe(
      "The schedule nightly-shop, asked with the form in velero (context kind-demo), was created while no view of it was open. Velero wrote its phase: Enabled.",
    );
    expect(keptEndWords({ ...created, outcome: { created: true, paused: true } })).toBe(
      "The schedule nightly-shop, asked with the form in velero (context kind-demo), was created while no view of it was open. It is paused: Velero does not read it until it is resumed.",
    );
    expect(keptEndWords({ ...created, outcome: { created: false, code: "conflict", text: "Taken." } })).toBe(
      "The schedule nightly-shop, asked with the form in velero (context kind-demo), ended while no view of it was open: Taken.",
    );
  });

  it("says a restore with the backup it is of", () => {
    const { schedule: _schedule, ...restore } = {
      ...end,
      kind: "restore" as const,
      name: "nightly-20261108120000",
      backup: "nightly",
    };

    expect(keptEndWords({ ...restore, outcome: { created: true, phase: "InProgress" } })).toBe(
      "The restore nightly-20261108120000 of the backup nightly, in velero (context kind-demo), was created while no view of it was open. Velero wrote its phase: InProgress.",
    );
    expect(keptEndWords({ ...restore, outcome: { created: false, code: "conflict", text: "Taken." } })).toBe(
      "The restore nightly-20261108120000 of the backup nightly, in velero (context kind-demo), ended while no view of it was open: Taken.",
    );
  });

  it("says the deletion of a backup by what its last reads showed, and never the backup deleted before a read showed it gone", () => {
    const { schedule: _schedule, ...base } = { ...end, kind: "delete-backup" as const, name: "nightly" };
    const what =
      "The deletion of the backup nightly, in velero (context kind-demo), was asked while no view of it was open";

    expect(
      Object.fromEntries(
        (["completed", "replaced", "refused", "failed", "unread", "in-progress"] as const).map((deletion) => [
          deletion,
          keptEndWords({ ...base, outcome: { created: true, deletion } }),
        ]),
      ),
    ).toEqual({
      completed: `${what}: the backup is not there any more: Velero deleted it, with the request.`,
      replaced: `${what}: the request is not there any more, and the backup is: another request for the same backup, which Velero started after this one, replaced it.`,
      refused: `${what}: Velero refused the request, and deleted nothing of the backup.`,
      failed: `${what}: a step of the deletion failed: the backup stays Deleting, and a new request tries again.`,
      unread: `${what}: Velero had not started the deletion when it was last read.`,
      "in-progress": `${what}: Velero was at the deletion when it was last read: the view of the backup says how it goes.`,
    });
    // Found after a lost answer: what the requests of the backup made since a minute before the confirmation and the
    // backup showed, whether a request was read or the backup was gone with none.
    expect(keptEndWords({ ...base, outcome: { created: true, deletion: "completed", found: true } })).toBe(
      `${what}, as the requests of the backup made since a minute before the confirmation and the backup show, read after the answer of its creation was lost: the backup is not there any more: Velero deleted it, with the request.`,
    );
    expect(keptEndWords({ ...base, outcome: { created: false, code: "conflict", text: "Taken." } })).toBe(
      "The deletion of the backup nightly, in velero (context kind-demo), ended while no view of it was open: Taken.",
    );
  });

  it("says what the backup alone showed when the requests of the backup could not be read, found or not", () => {
    const { schedule: _schedule, ...base } = { ...end, kind: "delete-backup" as const, name: "nightly" };
    const what =
      "The deletion of the backup nightly, in velero (context kind-demo), was asked while no view of it was open";
    const unread = (deletion: "completed" | "in-progress" | "unread", found = false) =>
      keptEndWords({
        ...base,
        outcome: { created: true, deletion, requestsUnread: true, ...(found ? { found } : {}) },
      });

    expect(unread("completed")).toBe(
      `${what}: the backup is not there any more: Velero deleted it. The requests of the backup could not be read.`,
    );
    expect(unread("in-progress")).toBe(
      `${what}: the backup was Deleting when it was last read: Velero is deleting it, or a deletion of it failed. The requests of the backup could not be read.`,
    );
    expect(unread("unread")).toBe(
      `${what}: the backup kept its phase when it was last read: Velero has not started the deletion, or refused it. The requests of the backup could not be read.`,
    );
    // Found with no request read: the backup alone says it.
    expect(unread("completed", true)).toBe(
      `${what}, as the backup shows, read after the answer of its creation was lost: the backup is not there any more: Velero deleted it. The requests of the backup could not be read.`,
    );
  });

  it("says a backup of the form as one asked with the form", () => {
    const { schedule: _schedule, ...form } = { ...end, kind: "backup" as const, name: "shop-by-hand" };

    expect(keptEndWords(form)).toBe(
      "The backup shop-by-hand, asked with the form in velero (context kind-demo), was created while no view of it was open. Velero wrote its phase: Completed.",
    );
  });
});
