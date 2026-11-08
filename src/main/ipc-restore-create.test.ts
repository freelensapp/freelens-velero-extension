// The procedures of a restore of the form, as the frames call them (SPEC-0017, RESTORE-01 to RESTORE-09, ACT-02,
// ACT-03, ACT-05 to ACT-07): the confirmation that refuses a name or a form the restore controller refuses, reads the
// backup by its name and answers the text of the Restore of the namespaces its spec names; the run that takes the name
// of the backup as it was typed, reads the backup again and sends that text byte for byte, then reads what Velero
// wrote of it; and every way it ends, a creation whose answer is not known never sent again and looked for by its name.

import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CHANNELS, readKeptEnds } from "../common/ipc";
import { BACKUP_PHASES } from "../common/phases";
import {
  NON_RESTORABLE,
  RESTORE_WORDS,
  type RestoreForm,
  restoreBodyText,
  restoreFromForm,
} from "../common/restore-form";
import { DiagnosticError } from "./diagnostic-transport";
import { registerHandlers } from "./ipc";
import { RESTORE_CREATE_WORDS, runRestoreCreate } from "./restore-create";
import { WriteGate } from "./write-gate";

import type { CatalogEntry } from "./catalog";
import type { DiagnosticObject } from "./diagnostic-kubernetes";
import type { IpcEvent, Registrar } from "./ipc";

const FRAME_A: IpcEvent = {
  senderFrame: { url: "https://cluster-a.renderer.freelens.app:1234/" },
  processId: 1,
  frameId: 4,
};
const NAME = "nightly-20261108120000";
const BACKUP = { kind: "Backup" as const, name: "nightly", uid: "nightly-uid" };
const NOW = Date.parse("2026-11-08T12:00:00Z");
const FORM: RestoreForm = {
  includedNamespaces: ["shop"],
  namespaceMapping: [["shop", "shop-restored"]],
  clusterResources: "none",
  existingResourcePolicy: "none",
};

function backupOf(phase: string | undefined, more: Record<string, unknown> = {}): DiagnosticObject {
  return {
    apiVersion: "velero.io/v1",
    kind: "Backup",
    metadata: { name: BACKUP.name, namespace: "velero", uid: BACKUP.uid },
    spec: { includedNamespaces: ["shop", "web-*"], excludedNamespaces: ["web-test"], storageLocation: "default" },
    ...(phase ? { status: { phase } } : {}),
    ...more,
  } as DiagnosticObject;
}

function textOf(form: RestoreForm = FORM, name = NAME): string {
  const body = restoreFromForm("velero", name, BACKUP.name, form, {
    includedNamespaces: ["shop", "web-*"],
    excludedNamespaces: ["web-test"],
  });

  if (!body) throw new Error("The form of the test is refused");
  return restoreBodyText(body);
}

function fixture() {
  const catalog: CatalogEntry[] = [
    { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a", status: "connected" },
  ];
  const handlers = new Map<string, (event: IpcEvent, payload: unknown) => Promise<unknown>>();
  const registrar: Registrar = {
    handle: (channel, handler) => handlers.set(channel, handler),
    broadcast: () => undefined,
  };
  // What the cluster of the test holds, and what its controller writes of a restore at each read.
  const state = {
    backup: backupOf("Completed") as DiagnosticObject | undefined,
    restores: new Map<string, DiagnosticObject>(),
    // The status the controller writes at each read of the restore, in turn; none when the list is empty.
    statuses: [] as Record<string, unknown>[],
    backupError: undefined as undefined | DiagnosticError,
    create: undefined as undefined | ((text: string) => Promise<DiagnosticObject>),
    now: NOW,
  };
  const adapter = {
    binding: { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a" },
    assertCurrent: vi.fn(),
    read: vi.fn(async (kind: string, _namespace: string, name: string, signal?: AbortSignal) => {
      // As the adapter does, a read with a signal that ended does not leave.
      if (signal?.aborted) throw new DiagnosticError("cancelled");
      if (kind === "Backup") {
        if (state.backupError) throw state.backupError;
        if (!state.backup || state.backup.metadata.name !== name) throw new DiagnosticError("not-found");
        return structuredClone(state.backup);
      }
      const restore = state.restores.get(name);

      if (!restore) throw new DiagnosticError("not-found");
      const status = state.statuses.shift();

      if (status) restore.status = status;
      return structuredClone(restore);
    }),
    createRestore: vi.fn(async (namespace: string, text: string): Promise<DiagnosticObject> => {
      if (state.create) return state.create(text);
      const body = JSON.parse(text) as DiagnosticObject;
      const created = {
        ...body,
        metadata: {
          ...body.metadata,
          namespace,
          uid: "restore-uid",
          creationTimestamp: new Date(state.now).toISOString(),
        },
      } as DiagnosticObject;

      state.restores.set(body.metadata.name, created);
      return structuredClone(created);
    }),
  };
  const gate = new WriteGate({ catalog: () => catalog, adapter: () => adapter as never, now: () => state.now });

  registerHandlers(registrar, {
    catalog: () => catalog,
    gate,
    pollMs: 5,
    now: () => state.now,
    sleep: async (milliseconds: number) => {
      state.now += milliseconds;
    },
  });
  const call = (channel: string, payload: unknown, event = FRAME_A) => {
    const handler = handlers.get(channel);

    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler(event, payload) as Promise<{
      ok: boolean;
      value?: Record<string, unknown>;
      code?: string;
      text?: string;
      stage?: string;
    }>;
  };
  const enable = () =>
    call(CHANNELS.gateEnable, {
      cluster: "cluster-a",
      namespace: "velero",
      confirmation: { context: "kind-a", namespace: "velero" },
    });
  const of = { cluster: "cluster-a", namespace: "velero", kind: "restore", target: BACKUP };
  const confirm = (form: RestoreForm = FORM, restore = NAME) =>
    call(CHANNELS.writeConfirm, { ...of, restore, restoreForm: form });
  const run = (token: string, typed = BACKUP.name, restore = NAME, request = randomUUID()) =>
    call(CHANNELS.writeRun, { ...of, restore, typed, token, request });
  const backupReads = () => adapter.read.mock.calls.filter(([kind]) => kind === "Backup");
  const restoreReads = () => adapter.read.mock.calls.filter(([kind]) => kind === "Restore");
  // The restore the controller wrote, created when the fixture says.
  const created = (text: string, more: { uid?: string; at?: number; spec?: Record<string, unknown> } = {}) => {
    const body = JSON.parse(text) as DiagnosticObject & { spec: Record<string, unknown> };

    return {
      ...body,
      metadata: {
        ...body.metadata,
        uid: more.uid ?? "restore-uid",
        creationTimestamp: new Date(more.at ?? state.now).toISOString(),
      },
      spec: { ...body.spec, ...more.spec },
    } as DiagnosticObject;
  };

  return { state, adapter, gate, call, enable, confirm, run, backupReads, restoreReads, created };
}

describe("the confirmation of a restore of the form", () => {
  it("is refused with writes off, and reads nothing", async () => {
    const { confirm, adapter } = fixture();

    expect(await confirm()).toMatchObject({ ok: false, code: "forbidden", stage: "gate" });
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it("reads the backup and answers the text of the Restore of its namespaces, with the token", async () => {
    const { enable, confirm, backupReads } = fixture();

    await enable();
    const confirmed = await confirm();

    expect(confirmed.ok).toBe(true);
    expect(confirmed.value?.text).toBe(textOf());
    // A Restore with its name and its namespace, no label and no annotation, its backup by name and never a schedule,
    // the policy always written, the cluster-scoped choice as made, and the fields that were set.
    expect(JSON.parse(String(confirmed.value?.text))).toEqual({
      apiVersion: "velero.io/v1",
      kind: "Restore",
      metadata: { name: NAME, namespace: "velero" },
      spec: {
        backupName: "nightly",
        includedNamespaces: ["shop"],
        namespaceMapping: { shop: "shop-restored" },
        includeClusterResources: false,
        existingResourcePolicy: "none",
      },
    });
    expect(backupReads()).toHaveLength(1);
  });

  it("takes a backup Completed or PartiallyFailed, and is a conflict for one in any other phase or of another UID", async () => {
    const { enable, confirm, state } = fixture();

    await enable();
    state.backup = backupOf("PartiallyFailed");
    expect((await confirm()).ok).toBe(true);
    for (const phase of [
      undefined,
      ...BACKUP_PHASES.filter((one) => one !== "Completed" && one !== "PartiallyFailed"),
    ]) {
      state.backup = backupOf(phase);
      expect([phase, await confirm()]).toEqual([
        phase,
        expect.objectContaining({
          ok: false,
          code: "conflict",
          stage: "read",
          text: RESTORE_CREATE_WORDS.notRestorable("nightly", phase),
        }),
      ]);
    }
    state.backup = backupOf("Completed", { metadata: { name: "nightly", namespace: "velero", uid: "other-uid" } });
    expect(await confirm()).toMatchObject({ code: "conflict", text: RESTORE_CREATE_WORDS.backupChanged });
    state.backup = undefined;
    expect(await confirm()).toMatchObject({ code: "not-found", text: RESTORE_CREATE_WORDS.backupGone("nightly") });
    state.backup = backupOf("Completed");
    state.backupError = new DiagnosticError("forbidden");
    expect(await confirm()).toMatchObject({ code: "forbidden", text: RESTORE_CREATE_WORDS.forbiddenRead("velero") });
  });

  it("refuses a form the restore controller refuses, with its words, and a mapping of a namespace the backup it read does not hold", async () => {
    const { enable, confirm } = fixture();

    await enable();
    expect(await confirm({ ...FORM, includedResources: ["pods", "nodes"] })).toMatchObject({
      ok: false,
      code: "validation",
      stage: "request",
      text: RESTORE_CREATE_WORDS.refused([
        RESTORE_WORDS.nonRestorable("nodes"),
        RESTORE_WORDS.resourceLists("excludes list cannot contain an item in the includes list: nodes"),
      ]),
    });
    expect(RESTORE_CREATE_WORDS.refused(["nodes are non-restorable resources"])).toBe(
      "The form is refused, and nothing was sent: nodes are non-restorable resources.",
    );
    // The backup excludes web-test, and holds no namespace named legacy.
    expect(await confirm({ ...FORM, namespaceMapping: [["web-test", "web-2"]] })).toMatchObject({
      text: RESTORE_CREATE_WORDS.refused([RESTORE_WORDS.usedForNothing("web-test")]),
    });
    expect(await confirm({ existingResourcePolicy: "none" })).toMatchObject({
      text: RESTORE_CREATE_WORDS.refused([RESTORE_WORDS.noClusterResources]),
    });
    // A namespace the lists of the restore leave out is not restored: its mapping is used for nothing.
    expect(await confirm({ ...FORM, namespaceMapping: [["web-a", "web-2"]] })).toMatchObject({
      text: RESTORE_CREATE_WORDS.refused([RESTORE_WORDS.leftOut("web-a")]),
    });
    expect(
      (await confirm({ ...FORM, includedNamespaces: ["shop", "web-a"], namespaceMapping: [["web-a", "web-2"]] })).ok,
    ).toBe(true);
  });

  it("is refused by the contract with a field the form does not offer, a target that is not a backup, or a name the API server refuses", async () => {
    const { enable, call } = fixture();

    await enable();
    const of = { cluster: "cluster-a", namespace: "velero", kind: "restore", target: BACKUP, restore: NAME };

    for (const payload of [
      { ...of },
      { ...of, restoreForm: { ...FORM, existingResourcePolicy: "replace" } },
      { ...of, restoreForm: { includedNamespaces: ["shop"] } },
      { ...of, restoreForm: { ...FORM, clusterResources: true } },
      { ...of, restoreForm: { ...FORM, namespaceMapping: { shop: "shop-2" } } },
      { ...of, restoreForm: { ...FORM, restorePVs: "false" } },
      { ...of, restore: "Nightly", restoreForm: FORM },
      { ...of, restore: "a".repeat(217), restoreForm: FORM },
      { ...of, target: { ...BACKUP, kind: "Schedule" }, restoreForm: FORM },
      { ...of, target: undefined, restoreForm: FORM },
      { ...of, restoreForm: FORM, typed: "nightly" },
      { ...of, restoreForm: FORM, backup: "nightly" },
    ]) {
      expect([payload, await call(CHANNELS.writeConfirm, payload)]).toEqual([
        payload,
        expect.objectContaining({ ok: false, code: "validation" }),
      ]);
    }
    // Each field of a restore the form does not offer (REQ-273), and the source the form never writes.
    for (const field of [
      "hooks",
      "resourceModifier",
      "resourcePolicy",
      "restoreStatus",
      "uploaderConfig",
      "preserveNodePorts",
      "itemOperationTimeout",
      "scheduleName",
      "backupName",
      "includeClusterResources",
    ])
      expect([field, await call(CHANNELS.writeConfirm, { ...of, restoreForm: { ...FORM, [field]: {} } })]).toEqual([
        field,
        expect.objectContaining({ ok: false, code: "validation" }),
      ]);
  });
});

describe("the run of a restore of the form", () => {
  it("takes the name of the backup typed, reads the backup again, sends the text byte for byte, once, and reads the restore until Velero writes its phase", async () => {
    const { enable, confirm, run, adapter, state, backupReads, restoreReads } = fixture();

    await enable();
    const confirmed = await confirm();

    state.statuses = [{}, { phase: "InProgress" }];
    const ended = await run(String(confirmed.value?.token));

    expect(ended).toEqual({ ok: true, value: { name: NAME, uid: "restore-uid", phase: "InProgress" } });
    expect(adapter.createRestore.mock.calls).toEqual([["velero", confirmed.value?.text, expect.anything()]]);
    expect(backupReads()).toHaveLength(2);
    expect(restoreReads()).toHaveLength(2);
  });

  it("answers each error of the validation Velero refused the restore with, and no phase after thirty seconds", async () => {
    const { enable, confirm, run, state } = fixture();

    await enable();
    state.statuses = [
      { phase: "FailedValidation", validationErrors: ["The BSL default is unavailable, cannot retrieve the backup"] },
    ];
    expect(await run(String((await confirm()).value?.token))).toEqual({
      ok: true,
      value: {
        name: NAME,
        uid: "restore-uid",
        phase: "FailedValidation",
        errors: ["The BSL default is unavailable, cannot retrieve the backup"],
      },
    });
    state.restores.clear();
    expect(await run(String((await confirm()).value?.token))).toEqual({
      ok: true,
      value: { name: NAME, uid: "restore-uid" },
    });
  });

  it("runs nothing for another name typed, or none, and keeps the review for the name as it is written", async () => {
    const { enable, confirm, run, call, adapter } = fixture();

    await enable();
    const token = String((await confirm()).value?.token);

    for (const typed of ["", "Nightly", "nightly ", "nightl"])
      expect([typed, await run(token, typed)]).toEqual([
        typed,
        expect.objectContaining({
          ok: false,
          code: "validation",
          stage: "request",
          text: RESTORE_CREATE_WORDS.typed("nightly"),
        }),
      ]);
    // A run with no name typed is not one the contract carries.
    expect(
      await call(CHANNELS.writeRun, {
        cluster: "cluster-a",
        namespace: "velero",
        kind: "restore",
        target: BACKUP,
        restore: NAME,
        token,
        request: randomUUID(),
      }),
    ).toMatchObject({ ok: false, code: "validation" });
    expect(adapter.createRestore).not.toHaveBeenCalled();
    expect((await run(token)).ok).toBe(true);
    expect(adapter.createRestore).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the backup changed since the review, went, or is in another phase", async () => {
    const { enable, confirm, run, adapter, state } = fixture();

    await enable();
    for (const [changed, expected] of [
      [
        backupOf("Completed", { metadata: { name: "nightly", namespace: "velero", uid: "other-uid" } }),
        { code: "conflict", text: RESTORE_CREATE_WORDS.backupChanged },
      ],
      ...[undefined, ...BACKUP_PHASES.filter((one) => one !== "Completed" && one !== "PartiallyFailed")].map(
        (phase) =>
          [backupOf(phase), { code: "conflict", text: RESTORE_CREATE_WORDS.notRestorable("nightly", phase) }] as const,
      ),
      [undefined, { code: "not-found", text: RESTORE_CREATE_WORDS.backupGone("nightly") }],
    ] as const) {
      state.backup = backupOf("Completed");
      const token = String((await confirm()).value?.token);

      state.backup = changed;
      expect(await run(token)).toMatchObject({ ok: false, stage: "read", ...expected });
    }
    expect(adapter.createRestore).not.toHaveBeenCalled();
  });

  it("runs only for the restore and the backup it was confirmed for, once, and the run carries none of the form", async () => {
    const { enable, confirm, run, call, adapter } = fixture();

    await enable();
    const token = String((await confirm()).value?.token);

    expect(await run(token, "nightly", "another-name")).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "confirmation",
    });
    expect(
      await call(CHANNELS.writeRun, {
        cluster: "cluster-a",
        namespace: "velero",
        kind: "restore",
        target: { ...BACKUP, uid: "other-uid" },
        restore: NAME,
        typed: "nightly",
        token,
        request: randomUUID(),
      }),
    ).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    expect(
      await call(CHANNELS.writeRun, {
        cluster: "cluster-a",
        namespace: "velero",
        kind: "restore",
        target: BACKUP,
        restore: NAME,
        typed: "nightly",
        restoreForm: FORM,
        token,
        request: randomUUID(),
      }),
    ).toMatchObject({ ok: false, code: "validation" });
    expect((await run(token)).ok).toBe(true);
    expect(await run(token)).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    expect(adapter.createRestore).toHaveBeenCalledTimes(1);
  });

  it("joins no run of the same identifier with another name typed", async () => {
    const { enable, confirm, run, adapter } = fixture();

    await enable();
    const token = String((await confirm()).value?.token);
    const request = randomUUID();
    const [ran, other] = await Promise.all([
      run(token, "nightly", NAME, request),
      run(token, "Nightly", NAME, request),
    ]);

    expect(ran.ok).toBe(true);
    expect(other).toMatchObject({ ok: false, code: "forbidden", text: "No write of this frame has this identifier." });
    expect(adapter.createRestore).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the text kept with the token is not the restore of the run, of its backup", async () => {
    const { adapter, state } = fixture();
    const write = {
      sender: "frame",
      kind: "restore" as const,
      status: { step: "confirmed" },
      controller: new AbortController(),
      done: false,
    };
    // A clock the waits move, so that a run that went on would end.
    let clock = NOW;
    const dependencies = (text: string) => ({
      gate: {
        take: () => ({ ok: true as const, value: { adapter, write, text, confirmedAt: NOW } }),
        finish: vi.fn(),
      } as never,
      now: () => clock,
      sleep: async (milliseconds: number) => {
        clock += milliseconds;
      },
    });
    const request = {
      cluster: "cluster-a",
      namespace: "velero",
      kind: "restore" as const,
      target: BACKUP,
      restore: NAME,
      typed: "nightly",
      token: randomUUID(),
      request: randomUUID(),
    };
    const ofWeekly = restoreFromForm("velero", NAME, "weekly", FORM, { includedNamespaces: ["shop"] });
    const elsewhere = restoreFromForm("elsewhere", NAME, "nightly", FORM, { includedNamespaces: ["shop"] });

    state.backup = backupOf("Completed");
    // A run that names no backup typed is not one of a restore, whatever its token.
    const { typed: _typed, ...untyped } = request;

    expect(await runRestoreCreate(dependencies(textOf()), "frame", untyped, () => () => undefined)).toMatchObject({
      ok: false,
      code: "validation",
      text: "The request is not one of a restore: a restore is asked of one backup, with its name and its form, and the name of the backup is typed before it is created. Nothing was sent.",
    });
    for (const text of [
      textOf(FORM, "another-name"),
      restoreBodyText(ofWeekly as never),
      restoreBodyText(elsewhere as never),
      "{",
    ]) {
      expect(await runRestoreCreate(dependencies(text), "frame", request, () => () => undefined)).toMatchObject({
        ok: false,
        code: "conflict",
        text: RESTORE_CREATE_WORDS.reviewChanged,
      });
    }
    expect(adapter.createRestore).not.toHaveBeenCalled();
  });

  it.each([
    ["creation", new DiagnosticError("forbidden"), "forbidden", false, RESTORE_CREATE_WORDS.forbiddenCreate("velero")],
    [
      "creation",
      new DiagnosticError("forbidden", undefined, "credential"),
      "request-failed",
      true,
      RESTORE_CREATE_WORDS.credential,
    ],
    [
      "creation",
      new DiagnosticError("validation", undefined, "refused"),
      "validation",
      false,
      RESTORE_CREATE_WORDS.rejected,
    ],
    ["creation", new DiagnosticError("validation"), "validation", false, RESTORE_CREATE_WORDS.unsent],
    ["creation", new DiagnosticError("not-found"), "not-found", false, RESTORE_CREATE_WORDS.notServed("velero")],
    ["creation", new DiagnosticError("conflict"), "conflict", false, RESTORE_CREATE_WORDS.exists(NAME, "velero")],
    ["creation", new DiagnosticError("request-failed"), "request-failed", false, RESTORE_CREATE_WORDS.declined],
    [
      "creation",
      new DiagnosticError("transport-unreachable"),
      "transport-unreachable",
      true,
      RESTORE_CREATE_WORDS.unreachable,
    ],
    ["creation", new DiagnosticError("target-changed"), "target-changed", false, RESTORE_CREATE_WORDS.changed],
    [
      "creation",
      new DiagnosticError("target-changed", undefined, "answered"),
      "submission-unknown",
      false,
      RESTORE_CREATE_WORDS.changedAfter(NAME),
    ],
    ["creation", new Error("broken"), "request-failed", false, RESTORE_CREATE_WORDS.failed],
    ["read", new DiagnosticError("forbidden"), "forbidden", false, RESTORE_CREATE_WORDS.forbiddenRead("velero")],
    [
      "read",
      new DiagnosticError("forbidden", undefined, "credential"),
      "request-failed",
      true,
      RESTORE_CREATE_WORDS.credential,
    ],
    ["read", new DiagnosticError("not-found"), "not-found", false, RESTORE_CREATE_WORDS.backupGone("nightly")],
    ["read", new DiagnosticError("deadline"), "deadline", true, RESTORE_CREATE_WORDS.slow],
    [
      "read",
      new DiagnosticError("transport-unreachable"),
      "transport-unreachable",
      true,
      RESTORE_CREATE_WORDS.unreachable,
    ],
    ["read", new DiagnosticError("cancelled"), "cancelled", true, RESTORE_CREATE_WORDS.cancelled],
    ["read", new DiagnosticError("request-failed"), "request-failed", false, RESTORE_CREATE_WORDS.failed],
    ["read", new DiagnosticError("target-changed"), "target-changed", false, RESTORE_CREATE_WORDS.changed],
    ["read", new Error("broken"), "request-failed", false, RESTORE_CREATE_WORDS.failed],
  ] as const)(
    "ends a refusal at the %s as %s with its code, its safety and its words",
    async (stage, error, code, retry, text) => {
      const { enable, confirm, run, adapter, state, restoreReads } = fixture();

      await enable();
      const confirmed = await confirm();

      if (stage === "read") state.backupError = error as DiagnosticError;
      else
        state.create = async () => {
          throw error;
        };
      expect(await run(String(confirmed.value?.token))).toEqual({ ok: false, code, stage, retry, text });
      expect(restoreReads()).toHaveLength(0);
      expect(adapter.createRestore).toHaveBeenCalledTimes(stage === "read" ? 0 : 1);
    },
  );

  it("says each end of the creation with its code, its stage and its safety, and keeps the ends of what was sent", async () => {
    const { enable, confirm, run, call, state } = fixture();

    await enable();
    const answered = new Map<string, string>();

    for (const [error, code, text] of [
      [new DiagnosticError("conflict"), "conflict", RESTORE_CREATE_WORDS.exists(NAME, "velero")],
      [new DiagnosticError("forbidden"), "forbidden", RESTORE_CREATE_WORDS.forbiddenCreate("velero")],
      [new DiagnosticError("validation", undefined, "refused"), "validation", RESTORE_CREATE_WORDS.rejected],
      [new DiagnosticError("not-found"), "not-found", RESTORE_CREATE_WORDS.notServed("velero")],
    ] as const) {
      const request = randomUUID();

      state.create = async () => {
        throw error;
      };
      expect(await run(String((await confirm()).value?.token), "nightly", NAME, request)).toMatchObject({
        ok: false,
        code,
        stage: "creation",
        text,
      });
      answered.set(request, code);
    }
    for (const error of [new DiagnosticError("validation"), new DiagnosticError("transport-unreachable")]) {
      state.create = async () => {
        throw error;
      };
      await run(String((await confirm()).value?.token));
    }
    const ends = readKeptEnds((await call(CHANNELS.writeEnds, { cluster: "cluster-a" })).value) ?? [];

    expect(new Map(ends.map((end) => [end.request, end.outcome.created ? "created" : end.outcome.code]))).toEqual(
      answered,
    );
  });

  it("looks for a restore whose answer was lost by its name, its backup and its creation time, and never sends it again", async () => {
    const { enable, confirm, run, adapter, state, created } = fixture();

    await enable();
    const lost = (found?: (text: string) => DiagnosticObject) => async (text: string) => {
      if (found) state.restores.set(NAME, found(text));
      throw new DiagnosticError("submission-unknown");
    };

    // Found: Velero wrote into its spec the schedule of the backup from its label, the default timeout of the operations
    // of the items, and the resources it never restores after the excluded ones.
    state.backup = backupOf("Completed", {
      metadata: {
        name: "nightly",
        namespace: "velero",
        uid: "nightly-uid",
        labels: { "velero.io/schedule-name": "daily" },
      },
    });
    const started = { scheduleName: "daily", itemOperationTimeout: "4h0m0s", excludedResources: [...NON_RESTORABLE] };

    state.create = lost((text) => created(text, { spec: started }));
    state.statuses = [{ phase: "InProgress" }];
    expect(await run(String((await confirm()).value?.token))).toEqual({
      ok: true,
      value: { name: NAME, uid: "restore-uid", phase: "InProgress", found: true },
    });
    // Found before Velero read it: the spec of the text alone.
    state.restores.clear();
    state.create = lost((text) => created(text));
    expect((await run(String((await confirm()).value?.token))).ok).toBe(true);
    // The resources excluded by the form come first, and the ones Velero adds are the ones they do not name.
    state.restores.clear();
    const excluding: RestoreForm = { ...FORM, excludedResources: ["secrets", "events"] };

    state.create = lost((text) =>
      created(text, {
        spec: { excludedResources: ["secrets", "events", ...NON_RESTORABLE.filter((one) => one !== "events")] },
      }),
    );
    expect((await run(String((await confirm(excluding)).value?.token))).ok).toBe(true);
    // Of another backup, of another spec, of another schedule, with a field the text does not write, or created before
    // the minute of the margin: not known to be this one.
    for (const found of [
      (text: string) => created(text, { spec: { backupName: "weekly" } }),
      (text: string) => created(text, { spec: { includedNamespaces: ["payments"] } }),
      (text: string) => created(text, { spec: { existingResourcePolicy: "update" } }),
      (text: string) => created(text, { spec: { namespaceMapping: { shop: "elsewhere" } } }),
      (text: string) => created(text, { spec: { includeClusterResources: true } }),
      (text: string) => created(text, { spec: { restorePVs: false } }),
      (text: string) => created(text, { spec: { hooks: {} } }),
      (text: string) => created(text, { spec: { scheduleName: "weekly" } }),
      (text: string) => created(text, { spec: { excludedResources: ["pods"] } }),
      (text: string) => created(text, { spec: { excludedResources: NON_RESTORABLE.slice(1) } }),
      (text: string) => created(text, { at: state.now - 61_000 }),
    ]) {
      state.restores.clear();
      state.create = lost(found);
      expect(await run(String((await confirm()).value?.token))).toMatchObject({
        ok: false,
        code: "submission-unknown",
        text: RESTORE_CREATE_WORDS.other(NAME, "velero"),
      });
    }
    state.restores.clear();
    state.create = lost();
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "submission-unknown",
      text: RESTORE_CREATE_WORDS.notDone(NAME),
    });
    expect(adapter.createRestore).toHaveBeenCalledTimes(15);
  });

  it("keeps the end of a run whose request was sent for its cluster, with its name and its backup", async () => {
    const { enable, confirm, run, call, state } = fixture();

    await enable();
    const request = randomUUID();

    state.statuses = [{ phase: "Completed" }];
    await run(String((await confirm()).value?.token), "nightly", NAME, request);
    const ends = await call(CHANNELS.writeEnds, { cluster: "cluster-a" });

    expect(readKeptEnds(ends.value)).toEqual([
      {
        request,
        kind: "restore",
        namespace: "velero",
        context: "kind-a",
        name: NAME,
        backup: "nightly",
        outcome: { created: true, phase: "Completed" },
        at: expect.any(Number),
      },
    ]);
  });
});

describe("what a restore of the form checks before and after its creation", () => {
  const OF = { cluster: "cluster-a", namespace: "velero", kind: "restore", target: BACKUP };
  const other = (url: string): IpcEvent => ({ senderFrame: { url }, processId: 1, frameId: 9 });

  // A frame of its own, whose address the test changes when the page is left.
  const ownFrame = async (call: ReturnType<typeof fixture>["call"]) => {
    const frame = structuredClone(FRAME_A);

    await call(
      CHANNELS.gateEnable,
      { cluster: "cluster-a", namespace: "velero", confirmation: { context: "kind-a", namespace: "velero" } },
      frame,
    );
    const confirmed = await call(CHANNELS.writeConfirm, { ...OF, restore: NAME, restoreForm: FORM }, frame);
    const leave = () => {
      // The frame now shows another cluster: it is not the frame of this one any more.
      frame.senderFrame = { url: "https://cluster-b.renderer.freelens.app:1234/" };
    };

    return { frame, token: confirmed.value?.token, leave };
  };
  const endsOf = async (call: ReturnType<typeof fixture>["call"]) =>
    readKeptEnds((await call(CHANNELS.writeEnds, { cluster: "cluster-a" })).value) ?? [];

  it("is refused with writes on for another namespace, and confirms no text the answer of the confirmation cannot carry", async () => {
    const { call, confirm, adapter } = fixture();

    await call(CHANNELS.gateEnable, {
      cluster: "cluster-a",
      namespace: "other",
      confirmation: { context: "kind-a", namespace: "other" },
    });
    expect(await confirm()).toMatchObject({ ok: false, code: "forbidden", stage: "gate" });
    await call(CHANNELS.gateEnable, {
      cluster: "cluster-a",
      namespace: "velero",
      confirmation: { context: "kind-a", namespace: "velero" },
    });
    // A form the contract takes, whose text is longer than the answer of a confirmation carries.
    const resources = (prefix: string) => Array.from({ length: 256 }, (_, at) => `${prefix}${at}`.padEnd(114, "x"));
    const refused = await confirm({
      ...FORM,
      includedResources: resources("i"),
      excludedResources: resources("e"),
    });

    expect(refused).toMatchObject({ ok: false, code: "validation", stage: "review" });
    expect(refused.text).toMatch(/^The restore of this form is written in \d+ characters, more than a review carries/);
    expect(refused.value).toBeUndefined();
    expect(adapter.createRestore).not.toHaveBeenCalled();
  });

  it("says a form of many problems in a text the views take, with how many more there are", async () => {
    const { enable, confirm } = fixture();

    await enable();
    const names = Array.from({ length: 25 }, (_, at) => `namespace-of-the-shop-${at}`);
    const refused = await confirm({ ...FORM, includedNamespaces: names, excludedNamespaces: names });

    expect(refused).toMatchObject({ ok: false, code: "validation", stage: "request" });
    expect(String(refused.text).length).toBeLessThanOrEqual(1024);
    expect(refused.text).toMatch(
      /^The form is refused, and nothing was sent: Invalid included\/excluded namespace lists: /,
    );
    expect(refused.text).toMatch(/ And \d+ more\.$/);
  });

  it("sends nothing when the frame went while the backup was read again, and keeps no end", async () => {
    const { call, adapter, state } = fixture();
    const { frame, token, leave } = await ownFrame(call);
    const read = adapter.read.getMockImplementation() as (...args: unknown[]) => Promise<DiagnosticObject>;

    adapter.read.mockImplementation(async (...args: unknown[]) => {
      // The page of the cluster is left during the read.
      if (args[0] === "Backup") leave();
      return read(...args);
    });
    const ended = await call(
      CHANNELS.writeRun,
      { ...OF, restore: NAME, typed: "nightly", token, request: randomUUID() },
      frame,
    );

    expect(ended).toMatchObject({ ok: false, code: "forbidden", stage: "frame", text: RESTORE_CREATE_WORDS.frameGone });
    expect(adapter.createRestore).not.toHaveBeenCalled();
    expect(state.restores.size).toBe(0);
    expect(await endsOf(call)).toEqual([]);
  });

  it("sends nothing when writes go off while the backup is read again, though the read answered", async () => {
    const { enable, confirm, run, adapter, gate } = fixture();

    await enable();
    const token = String((await confirm()).value?.token);
    const read = adapter.read.getMockImplementation() as (...args: unknown[]) => Promise<DiagnosticObject>;

    adapter.read.mockImplementation(async (...args: unknown[]) => {
      const answer = await read(...args);

      if (args[0] === "Backup") gate.disable("cluster-a");
      return answer;
    });
    expect(await run(token)).toMatchObject({
      ok: false,
      code: "cancelled",
      stage: "creation",
      text: RESTORE_CREATE_WORDS.cancelled,
    });
    expect(adapter.createRestore).not.toHaveBeenCalled();
  });

  it("answers no frame that went after the creation, and keeps the end for the cluster", async () => {
    const { call, adapter, state } = fixture();
    const { frame, token, leave } = await ownFrame(call);
    const create = adapter.createRestore.getMockImplementation() as (
      namespace: string,
      text: string,
    ) => Promise<DiagnosticObject>;

    adapter.createRestore.mockImplementation(async (namespace: string, text: string) => {
      const created = await create(namespace, text);

      leave();
      return created;
    });
    state.statuses = [{ phase: "InProgress" }];
    const request = randomUUID();
    const ended = await call(CHANNELS.writeRun, { ...OF, restore: NAME, typed: "nightly", token, request }, frame);

    expect(ended).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "frame",
      text: RESTORE_CREATE_WORDS.frameGoneAfter,
    });
    expect(adapter.createRestore).toHaveBeenCalledTimes(1);
    expect((await endsOf(call)).map((end) => [end.request, end.name, end.backup, end.outcome.created])).toEqual([
      [request, NAME, "nightly", true],
    ]);
  });

  it("ends as not known, never as cancelled, a creation dropped on this side once it was sent, and looks for it with a read the write that stopped does not end", async () => {
    const { enable, confirm, run, call, state, gate, created, restoreReads } = fixture();

    await enable();
    const request = randomUUID();

    // Writes go off while the API server has the request: the answer is dropped here, and the restore is not found.
    state.create = async () => {
      gate.disable("cluster-a");
      throw new DiagnosticError("cancelled");
    };
    expect(await run(String((await confirm()).value?.token), "nightly", NAME, request)).toMatchObject({
      ok: false,
      code: "submission-unknown",
      text: RESTORE_CREATE_WORDS.notDone(NAME),
    });
    expect((await endsOf(call)).map((end) => [end.request, end.outcome])).toEqual([
      [request, { created: false, code: "submission-unknown", text: RESTORE_CREATE_WORDS.notDone(NAME) }],
    ]);
    // Created all the same: the look by its name finds it, with a signal of its own.
    await enable();
    state.create = async (text: string) => {
      state.restores.set(NAME, created(text));
      gate.disable("cluster-a");
      throw new DiagnosticError("cancelled");
    };
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: true,
      value: { name: NAME, uid: "restore-uid", found: true },
    });
    expect(restoreReads().length).toBeGreaterThanOrEqual(2);
  });

  it("stops reading a restore of that name that is not the one created, and takes no answer of another name or with no UID", async () => {
    const { enable, confirm, run, adapter, state, restoreReads } = fixture();

    await enable();
    const create = adapter.createRestore.getMockImplementation() as (
      namespace: string,
      text: string,
    ) => Promise<DiagnosticObject>;

    // Another restore takes the name once the creation answered.
    adapter.createRestore.mockImplementationOnce(async (namespace: string, text: string) => {
      const created = await create(namespace, text);

      state.restores.set(NAME, {
        ...created,
        metadata: { ...created.metadata, uid: "another-uid" },
        status: { phase: "Completed" },
      } as DiagnosticObject);
      return created;
    });
    const ended = await run(String((await confirm()).value?.token));

    expect(ended).toMatchObject({ ok: true, value: { name: NAME, uid: "restore-uid" } });
    expect(ended.value?.phase).toBeUndefined();
    expect(restoreReads()).toHaveLength(1);
    for (const answer of [
      { name: "another-name", uid: "u" },
      { name: NAME, uid: "" },
    ]) {
      state.create = async (text: string) => {
        const body = JSON.parse(text) as DiagnosticObject;

        return { ...body, metadata: { ...body.metadata, ...answer } } as DiagnosticObject;
      };
      expect(await run(String((await confirm()).value?.token))).toMatchObject({
        ok: false,
        code: "submission-unknown",
        text: RESTORE_CREATE_WORDS.unknown(NAME),
      });
    }
    expect(restoreReads()).toHaveLength(1);
  });

  it("takes a restore found by its name for the one created within a minute before the confirmation, and not before", async () => {
    const { enable, confirm, run, state, created } = fixture();

    await enable();
    for (const [margin, ok] of [
      [59_000, true],
      [61_000, false],
    ] as const) {
      state.restores.clear();
      const token = String((await confirm()).value?.token);
      const at = state.now - margin;

      state.create = async (text: string) => {
        state.restores.set(NAME, created(text, { at }));
        throw new DiagnosticError("submission-unknown");
      };
      expect((await run(token)).ok).toBe(ok);
    }
  });

  it("frees its place among the writes once it ended: seventeen restores in a row", async () => {
    const { enable, confirm, run, adapter, state } = fixture();

    await enable();
    for (let count = 0; count < 17; count += 1) {
      state.restores.clear();
      expect([count, (await run(String((await confirm()).value?.token))).ok]).toEqual([count, true]);
    }
    expect(adapter.createRestore).toHaveBeenCalledTimes(17);
  });

  it("joins a run sent again with the same identifier while it runs, and gives no other frame, no other token and no other restore the run of a request in flight", async () => {
    const { enable, confirm, call, adapter } = fixture();

    await enable();
    const first = String((await confirm()).value?.token);
    const second = String((await confirm()).value?.token);
    const request = randomUUID();
    const payload = (token: string, restore = NAME) => ({ ...OF, restore, typed: "nightly", token, request });
    const running = call(CHANNELS.writeRun, payload(first));
    const [again, another, otherFrame, otherRestore] = await Promise.all([
      call(CHANNELS.writeRun, payload(first)),
      call(CHANNELS.writeRun, payload(second)),
      call(CHANNELS.writeRun, payload(first), other("https://cluster-a.renderer.freelens.app:1234/")),
      call(CHANNELS.writeRun, payload(first, "another-name")),
    ]);
    const ran = await running;

    expect(ran.ok).toBe(true);
    expect(again).toEqual(ran);
    for (const refused of [another, otherFrame, otherRestore])
      expect(refused).toMatchObject({
        ok: false,
        code: "forbidden",
        text: "No write of this frame has this identifier.",
      });
    expect(adapter.createRestore).toHaveBeenCalledTimes(1);
  });

  it("refuses a token of another frame, an expired one, another namespace and writes turned off after the confirmation", async () => {
    const { enable, confirm, call, run, adapter, state, gate } = fixture();

    await enable();
    const token = String((await confirm()).value?.token);

    expect(
      await call(
        CHANNELS.writeRun,
        { ...OF, restore: NAME, typed: "nightly", token, request: randomUUID() },
        other("https://cluster-a.renderer.freelens.app:1234/"),
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
    const expired = String((await confirm()).value?.token);

    state.now += 31_000;
    expect(await run(expired)).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    const elsewhere = String((await confirm()).value?.token);

    expect(
      await call(CHANNELS.writeRun, {
        ...OF,
        namespace: "velero-other",
        restore: NAME,
        typed: "nightly",
        token: elsewhere,
        request: randomUUID(),
      }),
    ).toMatchObject({ ok: false, code: "forbidden" });
    const off = String((await confirm()).value?.token);

    gate.disable("cluster-a");
    expect(await run(off)).toMatchObject({ ok: false, code: "forbidden", stage: "gate" });
    expect(adapter.createRestore).not.toHaveBeenCalled();
  });
});
