import { describe, expect, it } from "vitest";
import { patchText, pausePatch, readSchedulePatch, resumePatch } from "./schedule-patch";

describe("the patches of a pause and of a resume", () => {
  it("pauses with a test of the UID and an add of paused, and nothing else", () => {
    expect(pausePatch("nightly-uid")).toEqual([
      { op: "test", path: "/metadata/uid", value: "nightly-uid" },
      { op: "add", path: "/spec/paused", value: true },
    ]);
  });

  it("resumes with the tests of the UID, of paused and of the expression, a replace of paused and an add of skipImmediately, and nothing else", () => {
    for (const skipImmediately of [true, false])
      expect(resumePatch("nightly-uid", { expression: "CRON_TZ=Europe/Rome 0 3 * * *", skipImmediately })).toEqual([
        { op: "test", path: "/metadata/uid", value: "nightly-uid" },
        { op: "test", path: "/spec/paused", value: true },
        { op: "test", path: "/spec/schedule", value: "CRON_TZ=Europe/Rome 0 3 * * *" },
        { op: "replace", path: "/spec/paused", value: false },
        { op: "add", path: "/spec/skipImmediately", value: skipImmediately },
      ]);
  });

  it("writes the text as every text of the extension, and reads back only the patch of a pause or of a resume", () => {
    const pause = patchText(pausePatch("nightly-uid"));
    const resume = patchText(resumePatch("nightly-uid", { expression: "0 3 * * *", skipImmediately: false }));

    expect(pause.split("\n").slice(0, 6)).toEqual([
      "[",
      "  {",
      '    "op": "test",',
      '    "path": "/metadata/uid",',
      '    "value": "nightly-uid"',
      "  },",
    ]);
    expect(readSchedulePatch(pause)).toEqual({ action: "schedule-pause", uid: "nightly-uid" });
    expect(readSchedulePatch(resume)).toEqual({
      action: "schedule-resume",
      uid: "nightly-uid",
      expression: "0 3 * * *",
      skipImmediately: false,
    });
    // The same operations written another way are the same patch.
    expect(readSchedulePatch(JSON.stringify(pausePatch("nightly-uid")))).toEqual({
      action: "schedule-pause",
      uid: "nightly-uid",
    });
    const operations = resumePatch("nightly-uid", { expression: "0 3 * * *", skipImmediately: true });

    for (const wrong of [
      "{",
      "[]",
      JSON.stringify([pausePatch("nightly-uid")[1]]),
      JSON.stringify([...pausePatch("nightly-uid"), { op: "remove", path: "/spec/schedule", value: null }]),
      JSON.stringify(pausePatch("")),
      JSON.stringify(operations.slice(0, 4)),
      JSON.stringify([operations[1], operations[0], ...operations.slice(2)]),
      JSON.stringify(operations.map((operation, at) => (at === 2 ? { ...operation, value: 3 } : operation))),
      JSON.stringify(operations.map((operation, at) => (at === 4 ? { ...operation, value: "true" } : operation))),
      JSON.stringify(operations.map((operation, at) => (at === 3 ? { ...operation, value: true } : operation))),
      JSON.stringify(operations.map((operation, at) => (at === 1 ? { ...operation, from: "/spec" } : operation))),
      JSON.stringify(operations.map((operation, at) => (at === 4 ? { ...operation, op: "replace" } : operation))),
    ])
      expect([wrong, readSchedulePatch(wrong)]).toEqual([wrong, undefined]);
  });
});
