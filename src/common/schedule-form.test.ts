import { describe, expect, it } from "vitest";
import { parseExpression } from "./schedule-adherence";
import {
  EXPRESSION_BOUND,
  expressionProblem,
  expressionRefused,
  readScheduleBody,
  SCHEDULE_FORM_WORDS,
  scheduleBodyText,
  scheduleFromForm,
  scheduleNameProblem,
} from "./schedule-form";

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const WRAPPER = { expression: "0 3 * * *", paused: false, skipImmediately: false, useOwnerReferencesInBackup: false };

describe("the name of a schedule of the form", () => {
  it("is a DNS-1123 subdomain of 63 characters at most, which the label of every backup of it carries", () => {
    expect(scheduleNameProblem("n")).toBeUndefined();
    expect(scheduleNameProblem("a".repeat(63))).toBeUndefined();
    expect(scheduleNameProblem("nightly.shop-1")).toBeUndefined();
    expect(scheduleNameProblem("a".repeat(64))).toBe(SCHEDULE_FORM_WORDS.nameLong(64));
    expect(SCHEDULE_FORM_WORDS.nameLong(64)).toContain("64 characters, 1 more than 63");
    expect(scheduleNameProblem("")).toBe(SCHEDULE_FORM_WORDS.nameEmpty);
    for (const name of ["Nightly", "-nightly", "nightly-", ".nightly", "nightly.", "a..b", "a.-b", "a_b"])
      expect([name, scheduleNameProblem(name)]).toEqual([name, SCHEDULE_FORM_WORDS.nameForm]);
  });
});

describe("what the main process refuses of an expression", () => {
  it("refuses an empty one, one longer than the parser takes, and one with a character that is not printable", () => {
    expect(expressionProblem("", NOW)).toBe(SCHEDULE_FORM_WORDS.expressionEmpty);
    expect(expressionProblem(`0 3 * * * ${"x".repeat(EXPRESSION_BOUND)}`, NOW)).toBe(
      SCHEDULE_FORM_WORDS.expressionLong(EXPRESSION_BOUND + 10),
    );
    expect(expressionProblem("0 3 * *\t*", NOW)).toBe(SCHEDULE_FORM_WORDS.expressionNotPrintable);
    expect(expressionProblem("0 3 * * *\n", NOW)).toBe(SCHEDULE_FORM_WORDS.expressionNotPrintable);
    expect(expressionProblem("0 3\u00a0* * *", NOW)).toBe(SCHEDULE_FORM_WORDS.expressionNotPrintable);
  });

  it("refuses one with no instant, the three descriptors and an expression with none within five years", () => {
    for (const expression of ["@triggered", "@manual", "@none", "0 0 30 2 *", "CRON_TZ=Europe/Rome 0 0 31 4 *"])
      expect([expression, expressionProblem(expression, NOW)]).toEqual([expression, SCHEDULE_FORM_WORDS.noInstant]);
  });

  it("takes one with an instant, in a zone the runtime does not know as well, and leaves to Velero one its parser refuses", () => {
    for (const expression of [
      "0 3 * * *",
      "*/2 * * * *",
      "@every 6h",
      "@daily",
      "CRON_TZ=Europe/Rome 0 3 * * *",
      // The zone is the server's to know: whether an instant comes does not hang on it.
      "CRON_TZ=Mars/Olympus_Mons 0 3 * * *",
      // The leap day comes within five years.
      "0 0 29 2 *",
      "61 * * * *",
      "0 3 * *",
    ])
      expect([expression, expressionProblem(expression, NOW)]).toEqual([expression, undefined]);
  });

  it("says with the words of the controller what its parser refuses, and nothing of what it takes", () => {
    const refused = parseExpression("61 * * * *");

    expect(refused.kind).toBe("refused");
    expect(expressionRefused("61 * * * *")).toBe(refused.kind === "refused" ? refused.reason : "");
    expect(expressionRefused("0 3 * *")).toBe("invalid schedule: expected exactly 5 fields, found 4: [0 3 * *]");
    expect(expressionRefused("")).toBe("Schedule must be a non-empty valid Cron expression");
    expect(expressionRefused("0 3 * * *")).toBeUndefined();
    // An expression with no instant is one the parser takes: the main process refuses it on its own.
    expect(expressionRefused("@none")).toBeUndefined();
  });

  it("says with the words of the controller a zone Go would not load, which the runtime takes, and leaves the others", () => {
    const unknown = (zone: string) => `invalid schedule: unknown time zone "${zone}": unknown time zone ${zone}`;

    // Go loads a zone by its name as the zone database writes it: other letters, and an offset, are not one.
    for (const [expression, zone] of [
      ["CRON_TZ=europe/rome 0 3 * * *", "europe/rome"],
      ["CRON_TZ=Europe/ROME 0 3 * * *", "Europe/ROME"],
      ["TZ=utc 0 3 * * *", "utc"],
      ["CRON_TZ=local 0 3 * * *", "local"],
      ["CRON_TZ=+01:00 0 3 * * *", "+01:00"],
      ["CRON_TZ=us/Eastern @daily", "us/Eastern"],
    ])
      expect([expression, expressionRefused(expression)]).toEqual([expression, unknown(zone)]);
    // The names of the zone database, a name it keeps for an older one, UTC and Local are loaded; a name this runtime
    // does not know is left to the review, which says it.
    for (const expression of [
      "CRON_TZ=Europe/Rome 0 3 * * *",
      "TZ=Asia/Tokyo 0 3 * * *",
      "CRON_TZ=US/Eastern 0 3 * * *",
      "CRON_TZ=Etc/GMT+5 0 3 * * *",
      "CRON_TZ=UTC 0 3 * * *",
      "TZ=Local 0 3 * * *",
      "CRON_TZ=Mars/Olympus_Mons 0 3 * * *",
    ])
      expect([expression, expressionRefused(expression)]).toEqual([expression, undefined]);
  });
});

describe("the Schedule of the form", () => {
  it("writes the expression and the three flags always, and the template of the fields set alone", () => {
    expect(
      scheduleFromForm(
        "velero",
        "nightly-shop",
        { ...WRAPPER, expression: "CRON_TZ=Europe/Rome 0 3 * * *", skipImmediately: true },
        { includedNamespaces: ["shop"], storageLocation: "default", ttl: "48h" },
        NOW,
      ),
    ).toEqual({
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: { name: "nightly-shop", namespace: "velero" },
      spec: {
        schedule: "CRON_TZ=Europe/Rome 0 3 * * *",
        paused: false,
        skipImmediately: true,
        useOwnerReferencesInBackup: false,
        template: { includedNamespaces: ["shop"], storageLocation: "default", ttl: "48h0m0s" },
      },
    });
  });

  it("writes nothing for a name, an expression or a template the main process refuses", () => {
    expect(scheduleFromForm("velero", "Nightly", WRAPPER, { storageLocation: "default" }, NOW)).toBeUndefined();
    expect(
      scheduleFromForm("velero", "nightly", { ...WRAPPER, expression: "@none" }, { storageLocation: "default" }, NOW),
    ).toBeUndefined();
    expect(scheduleFromForm("velero", "nightly", WRAPPER, {}, NOW)).toBeUndefined();
    expect(
      scheduleFromForm("velero", "nightly", WRAPPER, { storageLocation: "default", excludedNamespaces: ["*"] }, NOW),
    ).toBeUndefined();
  });

  it("is written as every text of the extension, two spaces and the keys in one order, and read back", () => {
    const body = scheduleFromForm(
      "velero",
      "nightly",
      { ...WRAPPER, paused: true },
      { storageLocation: "default", snapshotVolumes: false },
      NOW,
    );

    if (!body) throw new Error("The form of the test is refused");
    const text = scheduleBodyText(body);

    expect(text).toBe(
      [
        "{",
        '  "apiVersion": "velero.io/v1",',
        '  "kind": "Schedule",',
        '  "metadata": {',
        '    "name": "nightly",',
        '    "namespace": "velero"',
        "  },",
        '  "spec": {',
        '    "paused": true,',
        '    "schedule": "0 3 * * *",',
        '    "skipImmediately": false,',
        '    "template": {',
        '      "snapshotVolumes": false,',
        '      "storageLocation": "default"',
        "    },",
        '    "useOwnerReferencesInBackup": false',
        "  }",
        "}",
      ].join("\n"),
    );
    expect(readScheduleBody(text)).toEqual(body);
    expect(readScheduleBody('{"kind":"Backup","metadata":{},"spec":{"template":{}}}')).toBeUndefined();
    expect(readScheduleBody('{"kind":"Schedule","metadata":{},"spec":{}}')).toBeUndefined();
    expect(readScheduleBody("not json")).toBeUndefined();
  });
});
