import { describe, expect, it } from "vitest";
import { counting } from "./evidence";
import { durationText, lifecycleText, phaseText, progressText, signalText, timeText } from "./operation-text";
import { RESTORE_PHASES } from "./phases";
import {
  countText,
  MAPPING_NOT_SET,
  MAPPING_OF_THE_REST,
  NO_DESTINATION,
  NOT_SET,
  namespaceMappings,
  RESTORE_SORTING,
  restoreScope,
  restoreSearchFields,
  restoreView,
  sourceNote,
  sourceText,
} from "./restore-view";

import type { RestoreResource } from "./types";

const now = Date.parse("2026-09-01T10:30:00Z");

function frozen<Value>(value: Value): Value {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) frozen(inner);
    Object.freeze(value);
  }
  return value;
}

function restore(
  status: RestoreResource["status"],
  spec: RestoreResource["spec"] = { backupName: "nightly-1" },
  name = "restore-1",
): RestoreResource {
  return frozen({
    metadata: { name, namespace: "velero-demo", uid: `uid-${name}`, creationTimestamp: "2026-09-01T09:59:00Z" },
    spec,
    status,
  });
}

const scope = (resource: RestoreResource) => Object.fromEntries(restoreScope(resource).map((fact) => [fact.id, fact]));

describe("what the views show of a restore", () => {
  it("reads a restore that waits with all its items and a failure as in flight, with its failure", () => {
    const view = restoreView(
      restore({
        phase: "WaitingForPluginOperationsPartiallyFailed",
        startTimestamp: "2026-09-01T10:00:00Z",
        progress: { itemsRestored: 40, totalItems: 40 },
        errors: 2,
        warnings: 1,
      }),
      now,
    );

    expect(phaseText(view.state)).toBe("Waiting for plugin operations");
    expect(lifecycleText(view.state)).toBe("In flight");
    expect(view.evidence.signal).toBe("failure");
    expect(signalText(view.evidence)).toBe("2 errors");
    expect(progressText(view.progress)).toBe("40 / 40 (100%)");
    expect(durationText(view.duration)).toBe("30m so far");
    expect(view.completed).toBeUndefined();
  });

  it.each(RESTORE_PHASES.map((phase) => [phase]))("has a state and words for the phase %s", (phase) => {
    const view = restoreView(restore({ phase }), now);

    expect(view.state.recognized).toBe(true);
    expect(phaseText(view.state)).not.toBe("");
    expect(["In flight", "Finished"]).toContain(lifecycleText(view.state));
    expect(signalText(view.evidence)).not.toBe("");
  });

  it.each([
    ["Queued", "a phase of a backup"],
    ["ReadyToStart", "a phase of a backup"],
    ["Deleting", "a phase of a backup"],
    ["Restoring", "a phase no release has"],
  ])("does not know %s, %s, and keeps its text", (phase) => {
    const view = restoreView(restore({ phase }), now);

    expect(view.state.recognized).toBe(false);
    expect(lifecycleText(view.state)).toBe("Unknown");
    expect(phaseText(view.state)).toBe(`Unknown: ${phase}`);
    expect(view.evidence.signal).toBe("unknown");
  });

  it.each([undefined, null, "", 0])("reads a phase of %j as not reported", (phase) => {
    const view = restoreView(restore({ phase: phase as never }), now);

    expect(phaseText(view.state)).toBe("Not reported");
    expect(lifecycleText(view.state)).toBe("Unknown");
  });

  it("reads the items of a restore, and not the ones of a backup", () => {
    const view = restoreView(
      restore({ phase: "InProgress", progress: { itemsRestored: 3, totalItems: 12, itemsBackedUp: 12 } as never }),
      now,
    );

    expect(progressText(view.progress)).toBe("3 / 12 (25%)");
  });

  it("says that a restore that failed its validation reports no time, as the release leaves it", () => {
    const view = restoreView(
      restore(
        { phase: "FailedValidation", validationErrors: ["No completed backups found for schedule"] },
        { scheduleName: "nightly" },
      ),
      now,
    );

    expect(view.started).toBeUndefined();
    expect(view.completed).toBeUndefined();
    expect(durationText(view.duration)).toBe("Not started");
    expect(lifecycleText(view.state)).toBe("Finished");
    expect(signalText(view.evidence)).toBe("1 validation error");
    expect(view.evidence.validationErrors).toEqual(["No completed backups found for schedule"]);
    // No backup is made up for a restore that names none.
    expect(view.backup).toBeUndefined();
    expect(sourceText(view)).toBe("Schedule nightly");
  });

  it("shows the errors a completed restore reports, against its phase", () => {
    const view = restoreView(
      restore({
        phase: "Completed",
        startTimestamp: "2026-09-01T10:00:00Z",
        completionTimestamp: "2026-09-01T10:02:00Z",
        errors: 3,
        warnings: 0,
      }),
      now,
    );

    expect(view.evidence.contradictions).toEqual(["The phase is Completed and the object reports errors"]);
    expect(view.evidence.signal).toBe("failure");
    expect(durationText(view.duration)).toBe("2m");
  });

  it("keeps the hooks and the item operations as they are reported, and the ones that are not as such", () => {
    const reported = restoreView(
      restore({
        phase: "PartiallyFailed",
        hookStatus: { hooksAttempted: 4, hooksFailed: 1 },
        restoreItemOperationsAttempted: 3,
        restoreItemOperationsCompleted: 2,
        restoreItemOperationsFailed: 1,
      }),
      now,
    );

    expect([reported.hooks.attempted, reported.hooks.failed].map(countText)).toEqual(["4", "1"]);
    expect(
      [reported.operations.attempted, reported.operations.completed, reported.operations.failed].map(countText),
    ).toEqual(["3", "2", "1"]);
    expect(counting(reported.hooks)).toBe(true);
    expect(counting(reported.operations)).toBe(true);
  });

  // The release writes no counter of zero: the hooks that did not fail and the operations that did not
  // end are counters that are not in the object.
  it("reads the counters the release did not write beside the ones it wrote as its zeros", () => {
    const view = restoreView(
      restore({ phase: "InProgress", hookStatus: { hooksAttempted: 2 }, restoreItemOperationsAttempted: 3 }),
      now,
    );

    expect([view.hooks.attempted, view.hooks.failed].map(countText)).toEqual(["2", "0"]);
    expect(view.hooks.failed).toEqual({ reported: true, value: 0, written: false });
    expect([view.operations.attempted, view.operations.completed, view.operations.failed].map(countText)).toEqual([
      "3",
      "0",
      "0",
    ]);
  });

  it("has no line for the hooks and the item operations of a restore that counted none", () => {
    // As the release leaves a restore without hooks and without operations of its items.
    const clean = restoreView(restore({ phase: "Completed", hookStatus: {} }), now);
    const running = restoreView(restore({ phase: "InProgress" }), now);
    const failed = restoreView(restore({ phase: "Failed", hookStatus: null }), now);

    expect(clean.hooks.attempted).toEqual({ reported: true, value: 0, written: false });
    expect(clean.operations.failed).toEqual({ reported: true, value: 0, written: false });
    expect(counting(clean.hooks)).toBe(false);
    expect(counting(clean.operations)).toBe(false);
    // Before the release counted, a counter that is missing is not a zero, and has no line all the same.
    expect(countText(running.hooks.attempted)).toBe("Not reported");
    expect(running.operations.failed.reported).toBe(false);
    expect(countText(failed.hooks.failed)).toBe("Not reported");
    for (const view of [running, failed]) {
      expect(counting(view.hooks)).toBe(false);
      expect(counting(view.operations)).toBe(false);
    }
    // What is not a count is shown as what it is.
    expect(
      counting(restoreView(restore({ phase: "Completed", hookStatus: { hooksFailed: "one" } as never }), now).hooks),
    ).toBe(true);
  });

  // The release counts the hooks of a restore when it finalizes it, which is after the phases that
  // follow its work: their status says that they were counted, and the phase does not.
  it("reads the hooks of a restore by their status being there, and not by the phase", () => {
    for (const phase of ["WaitingForPluginOperations", "Finalizing", "FinalizingPartiallyFailed", "Completed"]) {
      const waiting = restoreView(restore({ phase }), now);

      expect([phase, waiting.hooks.attempted]).toEqual([phase, { reported: false }]);
      expect([phase, waiting.hooks.failed]).toEqual([phase, { reported: false }]);
      // The operations of the plugins are counted with the work, as the errors are.
      expect([phase, waiting.operations.attempted]).toEqual([phase, { reported: true, value: 0, written: false }]);
    }
    const finalized = restoreView(restore({ phase: "InProgress", hookStatus: {} }), now);

    expect(finalized.hooks.attempted).toEqual({ reported: true, value: 0, written: false });
    expect(finalized.operations.attempted).toEqual({ reported: false });
  });

  it("says that a restore is being deleted when the object has a time of deletion", () => {
    const deleting = frozen({
      metadata: { name: "going", namespace: "velero-demo", deletionTimestamp: "2026-09-01T10:00:00Z" },
      status: { phase: "Completed" },
    }) as RestoreResource;

    expect(restoreView(deleting, now).deleting).toBe(true);
    expect(restoreView(restore({ phase: "Completed" }), now).deleting).toBe(false);
    // The phase is what it was: a restore has no phase for its deletion.
    expect(phaseText(restoreView(deleting, now).state)).toBe("Completed");
  });

  it("has no view of a restore without a status that says more than what is there", () => {
    const view = restoreView(frozen({ metadata: { name: "bare" } }) as RestoreResource, now);

    expect(view.namespace).toBe("");
    expect(phaseText(view.state)).toBe("Not reported");
    expect(progressText(view.progress)).toBe("Not reported");
    expect(sourceText(view)).toBe("Not reported");
    expect(JSON.stringify(view)).not.toContain("NaN");
  });
});

describe("source of a restore", () => {
  it.each([
    [{ backupName: "nightly-1" }, "nightly-1", ""],
    [{ scheduleName: "nightly" }, "Schedule nightly", "names no backup"],
    [{ backupName: "nightly-1", scheduleName: "nightly" }, "nightly-1, schedule nightly", "does not say which"],
    [{}, "Not reported", "neither a backup nor a schedule"],
    [{ backupName: "", scheduleName: "" }, "Not reported", "neither a backup nor a schedule"],
    [{ backupName: 7, scheduleName: null }, "Not reported", "neither a backup nor a schedule"],
  ])("shows of %j what the object names and nothing more", (spec, text, note) => {
    const view = restoreView(restore({ phase: "Completed" }, spec as never), now);

    expect(sourceText(view)).toBe(text);
    if (note) expect(sourceNote(view)).toContain(note);
    else expect(sourceNote(view)).toBe("");
  });

  it("does not say which of the two was submitted when the object names both", () => {
    const both = { backupName: "nightly-1", scheduleName: "nightly" };

    for (const phase of RESTORE_PHASES.filter((phase) => phase !== "FailedValidation")) {
      const note = sourceNote(restoreView(restore({ phase }, both), now));

      expect(note).toContain("Velero writes the backup it chose into a restore asked from a schedule");
      expect(note).toContain("the schedule of a backup into a restore asked from that backup");
      expect(note).not.toMatch(/was (asked|submitted) from (a|the) (backup|schedule)\b(?! and)/);
    }
  });

  // Velero refuses a restore that was submitted with both names. It can also refuse one after it wrote
  // the second name into it: what it refused is in the validation errors, and the note leads there.
  it("says of a restore that names both and failed its validation where what was refused is", () => {
    const view = restoreView(
      restore(
        {
          phase: "FailedValidation",
          validationErrors: ["Either a backup or schedule must be specified as a source for the restore, but not both"],
        },
        { backupName: "nightly-1", scheduleName: "nightly" },
      ),
      now,
    );

    expect(sourceText(view)).toBe("nightly-1, schedule nightly");
    expect(sourceNote(view)).toBe(
      "The object names both, and it failed its validation: what Velero refused is in its validation errors.",
    );
    expect(sourceNote(view)).not.toContain("does not say which");
    // The same of a restore asked from a schedule that Velero refused after it chose the backup.
    const chosen = restoreView(
      restore(
        { phase: "FailedValidation", validationErrors: ["The BSL default is unavailable, cannot retrieve the backup"] },
        { backupName: "nightly-1", scheduleName: "nightly" },
      ),
      now,
    );

    expect(sourceNote(chosen)).toBe(sourceNote(view));
    expect(sourceNote(chosen)).not.toMatch(/submitted/);
  });
});

describe("scope of a restore", () => {
  const asked = restore(
    { phase: "InProgress" },
    {
      backupName: "nightly-1",
      includedNamespaces: ["shop", "billing"],
      excludedResources: ["nodes", "events", "secrets"],
      namespaceMapping: { shop: "shop-restored", billing: "billing-restored" },
      labelSelector: {
        matchLabels: { app: "shop" },
        matchExpressions: [{ key: "tier", operator: "In", values: ["web"] }],
      },
      includeClusterResources: false,
      restorePVs: true,
      preserveNodePorts: false,
      existingResourcePolicy: "update",
      itemOperationTimeout: "4h0m0s",
      restoreStatus: { includedResources: ["workloads"], excludedResources: ["pods"] },
      uploaderConfig: { parallelFilesDownload: 8, writeSparseFiles: true },
      hooks: { resources: [{ name: "warm-cache" }, { name: "notify" }, {}] },
      resourceModifier: { kind: "ConfigMap", name: "patches" },
    },
  );

  it("shows every value as the object carries it", () => {
    const facts = scope(asked);

    expect(facts["included-namespaces"].value).toBe("shop, billing");
    expect(facts["excluded-resources"].value).toBe("nodes, events, secrets");
    expect(facts["label-selector"].value).toBe("app=shop, tier In (web)");
    expect(facts["cluster-resources"].value).toBe("No");
    expect(facts["persistent-volumes"].value).toBe("Yes");
    expect(facts["node-ports"].value).toBe("No");
    expect(facts["existing-resources"].value).toBe("update");
    expect(facts["item-operation-timeout"].value).toBe("4h0m0s");
    expect(facts["restored-status"].value).toBe("workloads, without pods");
    expect(facts.uploader.value).toBe("8 files at a time, sparse files written");
    expect(facts.hooks.value).toBe("3: warm-cache, notify");
    expect(facts["resource-modifier"].value).toBe("ConfigMap patches");
  });

  it("says of the two fields Velero fills that they are not only what was submitted", () => {
    const facts = scope(asked);

    expect(facts["excluded-resources"].note).toContain("Velero adds its own entries");
    expect(facts["item-operation-timeout"].note).toContain("Velero fills it");
    // The note is of a value that is there: what is not set has none of it.
    expect(scope(restore({ phase: "New" }, {}))["excluded-resources"].note).toBeUndefined();
  });

  it("says not set of what is not set, and gives it no value of its own", () => {
    for (const resource of [
      restore({ phase: "New" }, {}),
      restore({ phase: "New" }, undefined as never),
      frozen({ metadata: { name: "bare" } }) as RestoreResource,
      restore(
        { phase: "New" },
        {
          includedNamespaces: null,
          excludedNamespaces: [],
          includeClusterResources: null,
          restorePVs: null,
          labelSelector: null,
          orLabelSelectors: null,
          existingResourcePolicy: null,
          restoreStatus: null,
          uploaderConfig: null,
          resourceModifier: null,
          hooks: { resources: null },
        },
      ),
    ]) {
      const facts = restoreScope(resource);

      expect(facts.map((fact) => fact.value)).toEqual(facts.map(() => NOT_SET));
      expect(JSON.stringify(facts)).not.toMatch(/undefined|null|NaN/);
      expect(namespaceMappings(resource)).toEqual([]);
    }
  });

  it("tells what the release does with a field that is not set from a value of the object", () => {
    const facts = scope(restore({ phase: "New" }, {}));

    expect(facts["included-namespaces"]).toMatchObject({ value: NOT_SET, note: expect.stringContaining("release") });
    expect(facts["cluster-resources"]).toMatchObject({ value: NOT_SET, note: expect.stringContaining("release") });
    expect(facts["cluster-resources"].note).toBe(
      "The release restores the cluster-scoped resources when the restore includes every namespace and excludes none; otherwise it skips them, but the ones a restored item brings with it.",
    );
    expect(facts["restored-status"]).toEqual({
      id: "restored-status",
      name: "Status restored of",
      value: NOT_SET,
      note: "The release restores the status of the objects annotated velero.io/restore-status true, and of no other.",
    });
    expect(facts["existing-resources"].note).toBeUndefined();
    expect(MAPPING_NOT_SET).toContain("namespace of the same name");
    // Nothing says that every namespace is restored: what is restored is what the scope says.
    expect(MAPPING_NOT_SET).not.toContain("every namespace");
    expect(MAPPING_OF_THE_REST).toContain("not mapped");
  });

  it("writes the expressions of a selector as the object carries them", () => {
    const text = (labelSelector: unknown) =>
      scope(restore({ phase: "New" }, { labelSelector } as never))["label-selector"].value;

    expect(
      text({
        matchExpressions: [
          { key: "tier", operator: "In", values: ["web", "api"] },
          { key: "legacy", operator: "DoesNotExist" },
          { key: "zone", operator: "NotIn", values: [] },
        ],
      }),
    ).toBe("tier In (web, api), legacy DoesNotExist, zone NotIn");
    expect(text({ matchLabels: { app: "shop" }, matchExpressions: [{ key: "tier", operator: "Exists" }] })).toBe(
      "app=shop, tier Exists",
    );
    // What an expression lacks is said, and not made up.
    expect(text({ matchExpressions: [{ values: ["web"] }, null] })).toBe(
      "(no key) (no operator) (web), (no key) (no operator)",
    );
    expect(text({ matchExpressions: [] })).toBe(NOT_SET);
    expect(text({ matchExpressions: "tier" })).toBe(NOT_SET);
  });

  it("pairs each namespace with where it is restored into, in one order", () => {
    expect(namespaceMappings(asked)).toEqual([
      { from: "billing", into: "billing-restored" },
      { from: "shop", into: "shop-restored" },
    ]);
    // A pair the object carries is shown: one without a destination is not a mapping that is not set.
    expect(namespaceMappings(restore({ phase: "New" }, { namespaceMapping: { shop: "" } as never }))).toEqual([
      { from: "shop", into: NO_DESTINATION },
    ]);
    expect(
      namespaceMappings(restore({ phase: "New" }, { namespaceMapping: { shop: null, billing: 7 } as never })),
    ).toEqual([
      { from: "billing", into: NO_DESTINATION },
      { from: "shop", into: NO_DESTINATION },
    ]);
    for (const namespaceMapping of [{}, [], ["shop"], "shop", 7, null]) {
      expect(namespaceMappings(restore({ phase: "New" }, { namespaceMapping } as never))).toEqual([]);
    }
  });

  it("reads the alternatives of a selector, and what the uploader and the status say in part", () => {
    const facts = scope(
      restore(
        { phase: "New" },
        {
          orLabelSelectors: [{ matchLabels: { app: "shop" } }, { matchLabels: { app: "billing" } }],
          restoreStatus: {},
          uploaderConfig: { writeSparseFiles: false },
        },
      ),
    );

    expect(facts["alternative-selectors"].value).toBe("(app=shop) or (app=billing)");
    expect(facts.uploader.value).toBe("sparse files not written");
  });

  it("shows the filter of the restored status as the object carries it, and says what the release does with it", () => {
    const status = (restoreStatus: unknown) =>
      scope(restore({ phase: "New" }, { restoreStatus } as never))["restored-status"];

    // A filter that is there and names nothing has no value of the view in the place of its own.
    expect(status({}).value).toBe("Set, and it names no resource");
    expect(status({}).note).toContain("as one of every resource");
    expect(status({ includedResources: [], excludedResources: null }).value).toBe("Set, and it names no resource");
    expect(status({ excludedResources: ["pods"] }).value).toBe("without pods");
    expect(status({ excludedResources: ["pods"] }).note).toContain("as one of every resource");
    expect(status({ includedResources: ["workloads"] }).value).toBe("workloads");
    expect(status({ includedResources: ["workloads"] }).note).toBe(
      "An object annotated velero.io/restore-status says for itself, whatever is named here.",
    );
    expect(JSON.stringify([status({}), status({ excludedResources: ["pods"] })])).not.toContain('every resource"');
    for (const unset of [undefined, null, "all", 7]) expect(status(unset).value).toBe(NOT_SET);
  });

  it("shows the resource policy of the release after the reviewed one when the object carries it, and only then", () => {
    const with_ = restoreScope(
      restore({ phase: "New" }, { backupName: "nightly-1", resourcePolicy: { kind: "ConfigMap", name: "filters" } }),
    );
    const without = restoreScope(restore({ phase: "New" }, { backupName: "nightly-1" }));

    expect(with_.find((fact) => fact.id === "resource-policy")?.value).toBe("ConfigMap filters");
    expect(with_.map((fact) => fact.id).indexOf("resource-policy")).toBe(
      with_.map((fact) => fact.id).indexOf("resource-modifier") + 1,
    );
    expect(without.find((fact) => fact.id === "resource-policy")).toBeUndefined();
    expect(without.map((fact) => fact.name)).not.toContain("Resource policy");
  });

  it("does not change the restore it reads", () => {
    expect(() => {
      restoreView(asked, now);
      restoreScope(asked);
      namespaceMappings(asked);
    }).not.toThrow();
  });
});

describe("list of the restores", () => {
  const views = [
    restoreView(restore({ phase: "Completed", errors: 0, startTimestamp: "2026-09-01T10:00:00Z" }, {}, "b"), now),
    restoreView(restore({ phase: "Failed", errors: 4 }, { backupName: "nightly-9" }, "a"), now),
    restoreView(restore(undefined, { scheduleName: "nightly" }, "c"), now),
  ];

  it("has an order for every column, with what is not reported as the lowest value of the column", () => {
    for (const order of Object.values(RESTORE_SORTING)) {
      for (const view of views) expect(["string", "number"]).toContain(typeof order(view));
    }
    // In the ascending order what is not reported comes first, in the descending one last.
    const ascending = [...views].sort((one, other) => RESTORE_SORTING.errors(one) - RESTORE_SORTING.errors(other));

    expect(ascending.map((view) => view.name)).toEqual(["c", "b", "a"]);
    expect([...ascending].reverse().map((view) => view.name)).toEqual(["a", "b", "c"]);
    expect(views.map(RESTORE_SORTING.errors)).toEqual([0, 4, -1]);
    expect(views.map(RESTORE_SORTING.started)).toEqual([Date.parse("2026-09-01T10:00:00Z"), 0, 0]);
    expect(views.map(RESTORE_SORTING.source)).toEqual(["Not reported", "nightly-9", "Schedule nightly"]);
  });

  it("is searched by what its columns show and by the words of the status", () => {
    const fields = restoreSearchFields(
      restoreView(
        restore(
          { phase: "FailedValidation", validationErrors: ["Invalid included/excluded namespace lists"] },
          { backupName: "nightly-1", scheduleName: "nightly" },
        ),
        now,
      ),
    );

    for (const text of [
      "restore-1",
      "nightly-1",
      "nightly",
      "FailedValidation",
      "Failed validation",
      "Finished",
      "1 validation error",
      "Invalid included/excluded namespace lists",
    ]) {
      expect(fields).toContain(text);
    }
    expect(fields).not.toContain("");
  });

  it("is searched by what every column shows", () => {
    const view = restoreView(
      restore({
        phase: "InProgress",
        startTimestamp: "2026-09-01T10:00:00Z",
        progress: { itemsRestored: 3, totalItems: 12 },
      }),
      now,
    );
    const fields = restoreSearchFields(view);

    // One text for each of the eight columns, as the cell of the column shows it.
    for (const text of [
      view.name,
      view.namespace,
      sourceText(view),
      phaseText(view.state),
      signalText(view.evidence),
      progressText(view.progress),
      timeText(view.started),
      durationText(view.duration),
    ]) {
      expect(text).not.toBe("");
      expect(fields).toContain(text);
    }
    expect(fields).toContain("3 / 12 (25%)");
    expect(fields).toContain("30m so far");
    expect(fields).toContain("velero-demo");
  });
});
