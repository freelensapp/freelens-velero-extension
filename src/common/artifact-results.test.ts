import { beforeAll, describe, expect, it } from "vitest";
import {
  syntheticLog,
  syntheticResourceList,
  syntheticResults,
  syntheticVolumeInfo,
  tabExpectations,
} from "../../e2e/scripts/local-artifacts.mts";
import { fixtureNames, liveBackup, syncedBackups } from "../../e2e/scripts/local-fixtures.mts";
import { DEMO_NAMESPACE } from "../../e2e/scripts/local-kind.mts";
import {
  countDifferences,
  groupTitle,
  messageParts,
  moreCommand,
  otherShape,
  parseResults,
  placeTitle,
  RESULTS_STEP,
  resultPlaces,
  resultsSummary,
  shownAtFirst,
  shownOfAll,
  shownText,
} from "./artifact-results";

import type { ParsedResults } from "./artifact-results";

// A message as the hook of the server of the reviewed release writes one: each part after a space, and
// only the parts the entry has, the message always among them.
const hook = (parts: { resource?: string; name?: string; message: string; error?: string }) =>
  `${parts.resource === undefined ? "" : ` resource: /${parts.resource}`}${
    parts.name === undefined ? "" : ` name: /${parts.name}`
  } message: /${parts.message}${parts.error === undefined ? "" : ` error: /${parts.error}`}`;

describe("the results of an operation", () => {
  it("reads the errors and the warnings, each by Velero, cluster and namespace, with the counts", () => {
    const results = parseResults(
      JSON.stringify({
        warnings: { velero: [hook({ message: "a plugin is deprecated" })] },
        errors: {
          velero: ["the store answered late"],
          cluster: [
            hook({ resource: "persistentvolumes", name: "pv-1", message: "Error backing up item", error: "boom" }),
          ],
          namespaces: {
            shop: [
              hook({ resource: "pods", name: "cart", message: "Error backing up item", error: "hook failed" }),
              hook({ resource: "pods", name: "pay", message: "Error backing up item", error: "timeout" }),
            ],
            billing: [hook({ name: "ledger", message: "skipped" })],
          },
        },
      }),
    );

    expect(results).toMatchObject({ count: 6, errors: { count: 5 }, warnings: { count: 1 } });
    // The namespaces by their name, whatever the order they were written in.
    expect(results?.errors.namespaces.map((place) => [place.name, place.messages.length])).toEqual([
      ["billing", 1],
      ["shop", 2],
    ]);
    expect(results?.errors.velero.map((message) => message.text)).toEqual(["the store answered late"]);
    expect(results?.errors.cluster).toHaveLength(1);
    expect(results?.warnings).toMatchObject({ cluster: [], namespaces: [] });
  });

  it("tells the parts of a message the hook of the server wrote, and keeps what it wrote", () => {
    const written = hook({ resource: "pods", name: "cart", message: "Error backing up item", error: "hook failed" });
    const results = parseResults(JSON.stringify({ errors: { namespaces: { shop: [written] } }, warnings: {} }));

    expect(results?.errors.namespaces[0].messages[0]).toEqual({
      text: written,
      parts: { resource: "pods", name: "cart", message: "Error backing up item", error: "hook failed" },
    });
    const part = (message: string) =>
      parseResults(JSON.stringify({ errors: { velero: [message] }, warnings: {} }))?.errors.velero[0];

    // Only the parts the entry had: a message alone, a name without a resource, an error without a name.
    expect(part(hook({ message: "alone" }))?.parts).toEqual({ message: "alone" });
    expect(part(hook({ name: "ledger", message: "skipped" }))?.parts).toEqual({ name: "ledger", message: "skipped" });
    expect(part(hook({ resource: "pods", message: "listed", error: "denied" }))?.parts).toEqual({
      resource: "pods",
      message: "listed",
      error: "denied",
    });
    // An entry without words has its message all the same, empty, and parts that are empty are kept as such.
    expect(part(hook({ resource: "", name: "", message: "" }))?.parts).toEqual({ resource: "", name: "", message: "" });
    // An error of several lines, and one written twice, as the JSON format of the log has it.
    expect(part(hook({ message: "failed", error: "first line\nsecond line" }))?.parts?.error).toBe(
      "first line\nsecond line",
    );
    expect(part(`${hook({ message: "failed", error: "one" })} error: /two`)?.parts?.error).toBe("one error: /two");
  });

  it("ends each part where the next one of the hook begins, wherever the words of a part carry the name of another", () => {
    const part = (message: string) =>
      parseResults(JSON.stringify({ errors: { velero: [message] }, warnings: {} }))?.errors.velero[0].parts;

    // The words of a message that carry what a name, or a message, begins with are of the message.
    expect(part(" message: /the entry had name: /none and message: /none")).toEqual({
      message: "the entry had name: /none and message: /none",
    });
    // A resource ends at the name, or at the message when the entry has no name before it.
    expect(part(" resource: /pods name: /a name: /b message: /said name: /c")).toEqual({
      resource: "pods",
      name: "a name: /b",
      message: "said name: /c",
    });
    expect(part(" resource: /pods message: /said name: /later message: /again")).toEqual({
      resource: "pods",
      message: "said name: /later message: /again",
    });
    // A name that begins the text ends at the first message, and the message at the first error.
    expect(part(" name: /a message: /b message: /c error: /d error: /e")).toEqual({
      name: "a",
      message: "b message: /c",
      error: "d error: /e",
    });
    expect(part(" resource: / name: / message: / error: /")).toEqual({
      resource: "",
      name: "",
      message: "",
      error: "",
    });
    // What an error begins with, written before the message, is of the part it is in: the error of an
    // entry is after its message, and an entry with none after it has none.
    expect(part(" resource: /pods name: /a error: /b message: /said")).toEqual({
      resource: "pods",
      name: "a error: /b",
      message: "said",
    });
    expect(part(" name: /a error: /b message: /said error: /c")).toEqual({
      name: "a error: /b",
      message: "said",
      error: "c",
    });
    // What does not begin as the hook begins, or has no message, has no parts.
    for (const text of [
      "x resource: /pods message: /said",
      // A name that does not begin the text, of a message that has no resource, is no name of the hook.
      "x name: /a message: /said",
      "the entry had name: /a message: /said",
      " error: /alone",
      " name: /a",
      " resource: /pods name: /a",
      " resource: /pods name: /a error: /b",
      "resource: /pods message: /said",
      " message:/said",
      "",
    ])
      expect([text, part(text)]).toEqual([text, undefined]);
  });

  it("reads a message in a time that grows with its length, and not with its square, whatever it repeats", () => {
    // What a broken file may hold, and the hook of the server does not write: a message that begins as
    // one of the hook does, repeats the beginning of a name, and never comes to its message.
    const repeated = (length: number) => ` resource: /${" name: /".repeat(Math.ceil(length / 8))}`;
    const read = (text: string, times: number) => {
      const message = JSON.stringify({ errors: { velero: [text] }, warnings: {} });
      const before = performance.now();

      for (let time = 0; time < times; time += 1) parseResults(message);
      return performance.now() - before;
    };
    // Two lengths the runtime reads the JSON of in the same way: it takes a text of this size and over
    // by another way than a shorter one, which is no matter of the message.
    const small = repeated(128 * 1024);
    const large = repeated(256 * 1024);

    // Both are read once before anything is timed, and then as many times as make the small one take a
    // time that can be told from none.
    read(large, 1);
    const times = Math.max(1, Math.min(500, Math.ceil(40 / Math.max(read(small, 1), 0.02))));
    const taken = { small: [] as number[], large: [] as number[] };

    for (let run = 0; run < 5; run += 1) {
      taken.small.push(read(small, times));
      taken.large.push(read(large, times));
    }
    // The least of a few runs, on a machine that does other things: twice the length is about twice the
    // time, and far from four times.
    expect(Math.min(...taken.large) / Math.min(...taken.small)).toBeLessThan(3);
    // The message is one of no form of the hook: it is the text it is.
    expect(parseResults(JSON.stringify({ errors: { velero: [small] } }))?.errors.velero[0].parts).toBeUndefined();
  }, 120_000);

  it("keeps as text a message that is not in the form of the hook, as the ones of a restore are", () => {
    const restore =
      'could not restore, ConfigMap "settings" already exists. Warning: the in-cluster version is different';
    const results = parseResults(
      JSON.stringify({
        warnings: { namespaces: { shop: [restore] } },
        errors: { cluster: ["message: /without the space the hook begins with", " resource: /pods and nothing else"] },
      }),
    );

    expect(results?.warnings.namespaces[0].messages).toEqual([{ text: restore }]);
    expect(results?.errors.cluster).toEqual([
      { text: "message: /without the space the hook begins with" },
      { text: " resource: /pods and nothing else" },
    ]);
  });

  it("reads an operation with no error and no warning, as the release writes it and with a key left out", () => {
    for (const written of ['{"errors":{},"warnings":{}}', '{"warnings":{}}', '{"errors":{"velero":[]}}', "{}"]) {
      const results = parseResults(written);

      expect([written, results?.count, results?.errors.count, results?.warnings.count]).toEqual([written, 0, 0, 0]);
      expect(results?.errors).toEqual({ velero: [], cluster: [], namespaces: [], count: 0 });
    }
  });

  it("answers nothing for what is not of the shape of the release, and raises nothing", () => {
    for (const written of [
      "",
      "not JSON",
      "[]",
      "null",
      '"text"',
      "3",
      // A key the release does not write, at either level: nothing of it would be shown.
      '{"errors":{},"warnings":{},"notes":{}}',
      '{"errors":{"elsewhere":["x"]},"warnings":{}}',
      // What is not a list of texts, or a map of them.
      '{"errors":{"velero":"one"}}',
      '{"errors":{"velero":[1]}}',
      '{"errors":{"cluster":[null]}}',
      '{"errors":{"namespaces":["shop"]}}',
      '{"errors":{"namespaces":{"shop":"one"}}}',
      '{"errors":{"namespaces":{"shop":[{}]}}}',
      // Namespaces that are not written as a map, whatever they hold: a list has no names to read.
      '{"errors":{"namespaces":[]}}',
      '{"errors":{"namespaces":[["one"]]}}',
      '{"errors":{"namespaces":3}}',
      '{"warnings":{"namespaces":true}}',
      // The warnings are read as the errors are: what is not of the shape in them is not either.
      '{"errors":{},"warnings":{"velero":"one"}}',
      '{"errors":{"velero":["one"]},"warnings":{"cluster":[1]}}',
      '{"warnings":{"elsewhere":["x"]}}',
      '{"warnings":{"namespaces":{"shop":"one"}}}',
      '{"errors":[]}',
      '{"warnings":null}',
      '{"errors":"none"}',
    ])
      expect([written, parseResults(written)]).toEqual([written, undefined]);
  });

  it("reads a namespace named as a key every object has", () => {
    const results = parseResults('{"errors":{"namespaces":{"constructor":["a"],"__proto__":["b"],"toString":["c"]}}}');

    expect(results?.errors.namespaces.map((place) => place.name)).toEqual(["__proto__", "constructor", "toString"]);
    expect(results?.errors.count).toBe(3);
  });
});

// Results that are of the shape of the release: a test that gives another shape is wrong, and says so.
function read(written: object): ParsedResults {
  const results = parseResults(JSON.stringify(written));

  if (!results) throw new Error("The results of the test are not of the shape of the release");
  return results;
}

// As many messages as asked, each told from the others.
const many = (count: number, word = "m") => Array.from({ length: count }, (_, index) => `${word}${index}`);

describe("the places of the results, in the order they are read", () => {
  it("puts the errors before the warnings, each by Velero, the cluster and the namespaces by name", () => {
    const places = resultPlaces(
      read({
        warnings: { namespaces: { shop: ["w3"] }, velero: ["w1"], cluster: ["w2"] },
        errors: { namespaces: { shop: ["e3", "e4"], billing: ["e5"] }, cluster: ["e2"], velero: ["e1"] },
      }),
    );

    expect(places.map((place) => [place.kind, place.where, place.namespace, place.messages.length])).toEqual([
      ["errors", "velero", undefined, 1],
      ["errors", "cluster", undefined, 1],
      ["errors", "namespace", "billing", 1],
      ["errors", "namespace", "shop", 2],
      ["warnings", "velero", undefined, 1],
      ["warnings", "cluster", undefined, 1],
      ["warnings", "namespace", "shop", 1],
    ]);
    expect(places.map(placeTitle)).toEqual([
      "Velero: 1 error",
      "Cluster: 1 error",
      "Namespace billing: 1 error",
      "Namespace shop: 2 errors",
      "Velero: 1 warning",
      "Cluster: 1 warning",
      "Namespace shop: 1 warning",
    ]);
  });

  it("leaves out a place that holds no message, which is no place of the results", () => {
    const places = resultPlaces(read({ errors: { velero: [], namespaces: { shop: [], billing: ["e1"] } } }));

    expect(places.map((place) => [place.kind, place.where, place.namespace])).toEqual([
      ["errors", "namespace", "billing"],
    ]);
    expect(resultPlaces(read({}))).toEqual([]);
  });

  it("tells a namespace from Velero and from the cluster when it is named as they are", () => {
    const places = resultPlaces(read({ errors: { velero: ["e1"], namespaces: { velero: ["e2"], cluster: ["e3"] } } }));

    expect(places.map(placeTitle)).toEqual([
      "Velero: 1 error",
      "Namespace cluster: 1 error",
      "Namespace velero: 1 error",
    ]);
  });
});

describe("the words of the results", () => {
  it("says the count of the whole and of each group, and that Velero recorded neither when it did", () => {
    expect(resultsSummary(read({ errors: { velero: many(5) }, warnings: { cluster: ["w"] } }), "Backup")).toBe(
      "Velero recorded 6 messages for this backup: 5 errors and 1 warning.",
    );
    expect(resultsSummary(read({ errors: { velero: ["e"] } }), "Restore")).toBe(
      "Velero recorded 1 message for this restore: 1 error and no warning.",
    );
    expect(resultsSummary(read({ warnings: { velero: many(2) } }), "Backup")).toBe(
      "Velero recorded 2 messages for this backup: no error and 2 warnings.",
    );
    expect(resultsSummary(read({ errors: {}, warnings: {} }), "Backup")).toBe(
      "Velero recorded no error and no warning for this backup.",
    );
    expect(resultsSummary(read({}), "Restore")).toBe("Velero recorded no error and no warning for this restore.");
  });

  it("gives a group its count in its title, and says none in words", () => {
    expect([groupTitle("errors", 5), groupTitle("warnings", 1)]).toEqual(["Errors: 5", "Warnings: 1"]);
    expect([groupTitle("errors", 0), groupTitle("warnings", 0)]).toEqual(["Errors: none", "Warnings: none"]);
  });

  it("names the parts the hook of the server wrote, in its order, and none for a message of another form", () => {
    const [whole, alone, other] = read({
      errors: {
        velero: [
          " resource: /pods name: /cart message: /Error backing up item error: /hook failed",
          " message: /alone",
          "could not restore",
        ],
      },
    }).errors.velero;

    expect(messageParts(whole)).toEqual([
      { key: "resource", name: "Resource", value: "pods" },
      { key: "name", name: "Name", value: "cart" },
      { key: "message", name: "Message", value: "Error backing up item" },
      { key: "error", name: "Error", value: "hook failed" },
    ]);
    expect(messageParts(alone)).toEqual([{ key: "message", name: "Message", value: "alone" }]);
    expect(messageParts(other)).toBeUndefined();
  });

  it("says that results of another shape are shown as text, and of which operation they are", () => {
    expect(otherShape("Backup")).toBe(
      "The results of this backup are not of the shape the extension was written for: they are shown as the text they are.",
    );
    expect(otherShape("Restore")).toContain("The results of this restore are not of the shape");
  });
});

describe("the messages that are shown when the results are of thousands", () => {
  const places = resultPlaces(
    read({
      errors: { velero: many(150), namespaces: { billing: many(120), shop: many(3000) } },
      warnings: { cluster: many(7) },
    }),
  );

  it("shows the first ones in the order of the page, up to a bound on the whole", () => {
    expect(RESULTS_STEP).toBe(200);
    expect(shownAtFirst(places)).toEqual([150, 50, 0, 0]);
    expect(shownAtFirst(places, 10_000)).toEqual([150, 120, 3000, 7]);
    expect(shownAtFirst(places, 0)).toEqual([0, 0, 0, 0]);
    expect(shownAtFirst([])).toEqual([]);
  });

  it("says how many of a place are shown, and names the command that shows the ones after them", () => {
    const [, billing, shop, cluster] = places;

    expect(shownText(billing, 50)).toBe("50 of 120 shown.");
    expect(shownText(shop, 0)).toBe("0 of 3000 shown.");
    // A step of the bound, or what is left when it is less.
    expect(moreCommand(billing, 50)).toBe("Show 70 more errors of the namespace billing");
    expect(moreCommand(shop, 0)).toBe("Show 200 more errors of the namespace shop");
    expect(moreCommand(shop, 2999)).toBe("Show 1 more error of the namespace shop");
    expect(moreCommand(cluster, 0)).toBe("Show 7 more warnings of the cluster");
    expect(moreCommand(places[0], 150)).toBeUndefined();
    expect(moreCommand(places[0], 100)).toBe("Show 50 more errors of Velero");
  });

  it("says how many of the whole are shown while some are not, and nothing when all are", () => {
    const results = read({ errors: { velero: many(150), namespaces: { shop: many(3000) } } });

    expect(shownOfAll(200, results)).toBe(
      "200 of the 3150 messages are shown. The others are shown by the command of their place.",
    );
    expect(shownOfAll(3150, results)).toBeUndefined();
  });
});

describe("the count of the results beside the counter of the status", () => {
  const results = read({ errors: { velero: many(3) }, warnings: { cluster: many(2) } });
  const GROWS = (operation: string) =>
    `The operations of the plugins of a ${operation} add their errors to its status after its results were written, and not to the results: the status can count more.`;
  const FINALIZED =
    "When Velero finalizes a restore it adds what it finds to the results before it writes the status: the results can count more until the restore ends.";
  const UNNAMED = "They differ for a reason the extension does not name.";

  it("says nothing when the two agree, and of a counter the status does not report", () => {
    expect(countDifferences(results, "Backup", { errors: 3, warnings: 2 })).toEqual([]);
    expect(countDifferences(results, "Restore", { errors: 3, warnings: 2 })).toEqual([]);
    expect(countDifferences(results, "Backup", {})).toEqual([]);
    expect(countDifferences(results, "Backup", undefined)).toEqual([]);
    // One counter that agrees and one that is not reported.
    expect(countDifferences(results, "Restore", { warnings: 2 })).toEqual([]);
    expect(countDifferences(read({}), "Backup", { errors: 0, warnings: 0 })).toEqual([]);
  });

  it("says both counts of the errors of an operation whose status counts more, and that its plugins add to it", () => {
    expect(countDifferences(results, "Backup", { errors: 5, warnings: 2 })).toEqual([
      `The status of the backup reports 5 errors, and its results hold 3. ${GROWS("backup")}`,
    ]);
    expect(countDifferences(read({}), "Backup", { errors: 1 })).toEqual([
      `The status of the backup reports 1 error, and its results hold none. ${GROWS("backup")}`,
    ]);
    // The release adds the errors of the operations of a restore to its status in the same way, and
    // writes them into its results no more than it does for a backup.
    expect(countDifferences(results, "Restore", { errors: 4, warnings: 2 })).toEqual([
      `The status of the restore reports 4 errors, and its results hold 3. ${GROWS("restore")}`,
    ]);
    expect(countDifferences(results, "Restore", { errors: 4 }, "PartiallyFailed")).toEqual([
      `The status of the restore reports 4 errors, and its results hold 3. ${GROWS("restore")}`,
    ]);
  });

  it("names no reason for what the plugins of an operation do not explain: fewer errors in the status, the warnings", () => {
    for (const [of, operation] of [
      ["Backup", "backup"],
      ["Restore", "restore"],
    ] as const) {
      expect(countDifferences(results, of, { errors: 1 })).toEqual([
        `The status of the ${operation} reports 1 error, and its results hold 3. ${UNNAMED}`,
      ]);
      expect(countDifferences(results, of, { warnings: 4 })).toEqual([
        `The status of the ${operation} reports 4 warnings, and its results hold 2. ${UNNAMED}`,
      ]);
      // Each count with its own reason, and one reason said once for the two it is of.
      expect(countDifferences(results, of, { errors: 5, warnings: 0 })).toEqual([
        `The status of the ${operation} reports 5 errors, and its results hold 3. ${GROWS(operation)}`,
        `The status of the ${operation} reports no warning, and its results hold 2. ${UNNAMED}`,
      ]);
      expect(countDifferences(results, of, { errors: 2, warnings: 3 })).toEqual([
        `The status of the ${operation} reports 2 errors, and its results hold 3. The status of the ${operation} reports 3 warnings, and its results hold 2. ${UNNAMED}`,
      ]);
    }
  });

  it("says of a restore that is being finalized that its results are added to before its status is written", () => {
    for (const phase of ["Finalizing", "FinalizingPartiallyFailed"]) {
      expect([phase, countDifferences(results, "Restore", { errors: 2, warnings: 1 }, phase)]).toEqual([
        phase,
        [
          `The status of the restore reports 2 errors, and its results hold 3. The status of the restore reports 1 warning, and its results hold 2. ${FINALIZED}`,
        ],
      ]);
      // It explains results that count more, and nothing else: a status that counts more warnings is not
      // what the finalization leaves behind it.
      expect([phase, countDifferences(results, "Restore", { errors: 2, warnings: 9 }, phase)]).toEqual([
        phase,
        [
          `The status of the restore reports 2 errors, and its results hold 3. ${FINALIZED}`,
          `The status of the restore reports 9 warnings, and its results hold 2. ${UNNAMED}`,
        ],
      ]);
    }
  });

  it("names no reason for results that count more outside the finalization of a restore", () => {
    // A restore that ended: its status was written after its results.
    for (const phase of ["Completed", "PartiallyFailed", "WaitingForPluginOperations", "InProgress", undefined])
      expect([phase, countDifferences(results, "Restore", { errors: 2 }, phase)]).toEqual([
        phase,
        [`The status of the restore reports 2 errors, and its results hold 3. ${UNNAMED}`],
      ]);
    // The results of a backup are written once: its finalization adds nothing to them.
    for (const phase of ["Finalizing", "FinalizingPartiallyFailed"])
      expect([phase, countDifferences(results, "Backup", { errors: 2, warnings: 1 }, phase)]).toEqual([
        phase,
        [
          `The status of the backup reports 2 errors, and its results hold 3. The status of the backup reports 1 warning, and its results hold 2. ${UNNAMED}`,
        ],
      ]);
  });
});

// The results the fixtures give the store for the two backups its sync creates, made as the fixtures make
// them, beside the status the fixtures write into the metadata of each. The generator counted the messages of
// the results while it wrote the log, where each is an entry at error or at warning, with its fields.
describe("the results of the backups the store is given for the tabs", () => {
  const run = "a1b2c3d4";
  const owner = "synthetic-owner";
  const started = Date.parse("2026-10-05T10:00:00.000Z");
  // The artifacts the fixtures give the store, with a log of a thousand lines in the place of the one of two
  // hundred thousand: the generator writes the same entries at error and at warning, each with its fields,
  // into a log of any length, and nothing else the store is given depends on that length.
  const make = () => {
    const options = { backup: fixtureNames(run).syncedBackup, namespace: DEMO_NAMESPACE, started };
    const artifacts = {
      ...options,
      log: syntheticLog({ ...options, lines: 1000 }),
      results: syntheticResults(),
      resourceList: syntheticResourceList(),
      volumeInfo: syntheticVolumeInfo(started),
      empty: {
        results: syntheticResults("empty"),
        resourceList: syntheticResourceList("empty"),
        volumeInfo: syntheticVolumeInfo(started, "empty"),
      },
    };
    // The two are made like the backup the server completed for the run.
    const like = { ...liveBackup(owner, run), status: { phase: "Completed" } };

    return {
      artifacts,
      ...artifacts.log.facts,
      made: syncedBackups(owner, run, started, like, tabExpectations(artifacts)),
    };
  };
  let fixture: ReturnType<typeof make>;
  const statusOf = (backup: ReturnType<typeof make>["made"]["synced"]) =>
    backup.status as { phase?: string; errors?: number; warnings?: number };
  const parsed = (text: string) => {
    const results = parseResults(text);

    if (!results) throw new Error("The results the fixtures give the store are not read");
    return results;
  };

  // Made once, when the cases of this part begin.
  beforeAll(() => {
    fixture = make();
  });

  it("reads the errors and the warnings of the first where the log filed them, each in the parts of its entry", () => {
    const { artifacts, entries } = fixture;
    const results = parsed(artifacts.results.text);
    const places = resultPlaces(results);
    // Each place with the entries the generator filed there, in the order of the log, and the parts of each.
    const told = new Map<string, { text: string; parts: Record<string, string> }[]>();

    for (const { level, place, namespace, resource, name, message, error, text } of entries) {
      const key = `${level === "error" ? "errors" : "warnings"} ${place} ${namespace ?? ""}`;
      const parts = {
        ...(resource === undefined ? {} : { resource }),
        ...(name === undefined ? {} : { name }),
        message,
        ...(error === undefined ? {} : { error }),
      };

      told.set(key, [...(told.get(key) ?? []), { text, parts }]);
    }
    expect(
      new Map(places.map((place) => [`${place.kind} ${place.where} ${place.namespace ?? ""}`, place.messages])),
    ).toEqual(told);
    // The errors first, then the warnings, each by Velero, the cluster and the namespaces by their name.
    expect(places.map((place) => [place.kind, place.where, place.namespace])).toEqual([
      ["errors", "velero", undefined],
      ["errors", "namespace", "synthetic-ns-17"],
      ["errors", "namespace", "synthetic-ns-3"],
      ["warnings", "velero", undefined],
      ["warnings", "cluster", undefined],
    ]);
  });

  it("counts in the first the entries of the log at each level, as its status does, and says no difference", () => {
    const { artifacts, entries, levels, made } = fixture;
    const results = parsed(artifacts.results.text);
    const status = statusOf(made.synced);

    expect([results.errors.count, results.warnings.count]).toEqual([levels.error, levels.warning]);
    expect([status.errors, status.warnings]).toEqual([levels.error, levels.warning]);
    expect(countDifferences(results, "Backup", status, status.phase)).toEqual([]);
    expect(resultsSummary(results, "Backup")).toBe(
      `Velero recorded ${entries.length} messages for this backup: ${levels.error} errors and ${levels.warning} warnings.`,
    );
  });

  it("reads the results of the second as neither errors nor warnings, of a status that counts neither", () => {
    const { artifacts, made } = fixture;
    const results = parsed(artifacts.empty.results.text);
    const status = statusOf(made.withoutLog);

    expect([results.count, resultPlaces(results)]).toEqual([0, []]);
    // The release writes no counter of zero: there is nothing to compare, and nothing is said of it.
    expect([status.errors, status.warnings]).toEqual([undefined, undefined]);
    expect(countDifferences(results, "Backup", status, status.phase)).toEqual([]);
    expect(resultsSummary(results, "Backup")).toBe("Velero recorded no error and no warning for this backup.");
  });
});
