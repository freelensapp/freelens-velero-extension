import { describe, expect, it } from "vitest";
import goldens from "../../test/backup-from-schedule.goldens.json";
import {
  BACKUP_NAME_LIMIT,
  BACKUP_NAME_WORDS,
  backupFromSchedule,
  backupFromScheduleMeaning,
  backupNameProblem,
  bodyText,
  MEANING_WORDS,
  proposedBackupName,
  SCHEDULE_NAME_LABEL,
  scheduleRefused,
} from "./backup-from-schedule";

// A schedule as the main process reads it: plain JSON, with fields the views do not read.
function schedule(more: { metadata?: Record<string, unknown>; spec?: Record<string, unknown> } = {}) {
  return {
    apiVersion: "velero.io/v1",
    kind: "Schedule",
    metadata: {
      name: "daily",
      namespace: "velero",
      uid: "5b0c2f6e-3f6a-4d2b-9a43-0c1d2e3f4a5b",
      resourceVersion: "4242",
      creationTimestamp: "2026-11-01T03:00:00Z",
      ...more.metadata,
    },
    spec: {
      schedule: "0 3 * * *",
      template: {
        includedNamespaces: ["shop"],
        storageLocation: "default",
        ttl: "720h0m0s",
        hooks: {
          resources: [{ name: "freeze", pre: [{ exec: { command: ["/sbin/fsfreeze", "--freeze", "/data"] } }] }],
        },
      },
      ...more.spec,
    },
    status: { phase: "Enabled", lastBackup: "2026-11-08T03:00:00Z" },
  };
}

describe("the name of a backup asked from a schedule", () => {
  it("is proposed as the command line proposes it, the schedule and the time in UTC to the second", () => {
    expect(proposedBackupName("daily", Date.parse("2026-11-08T03:41:05.987Z"))).toBe("daily-20261108034105");
    expect(proposedBackupName("daily", Date.parse("2026-01-02T00:00:00+01:00"))).toBe("daily-20260101230000");
  });

  it("is a DNS-1123 subdomain of 216 characters at most, each refusal with its words", () => {
    const long = (length: number) => "a".repeat(length);

    expect([long(1), long(BACKUP_NAME_LIMIT), "daily-20261108034105", "a.b-c.d", "0-9"].map(backupNameProblem)).toEqual(
      [undefined, undefined, undefined, undefined, undefined],
    );
    expect(backupNameProblem("")).toBe(BACKUP_NAME_WORDS.empty);
    expect(backupNameProblem(long(BACKUP_NAME_LIMIT + 1))).toBe("The name has 217 characters, 1 more than 216.");
    for (const name of [
      "Daily",
      "-daily",
      "daily-",
      ".daily",
      "daily.",
      "a..b",
      "a.-b",
      "a-.b",
      "daily_1",
      "daily 1",
    ]) {
      expect([name, backupNameProblem(name)]).toEqual([name, BACKUP_NAME_WORDS.form]);
    }
  });

  it("is refused for a schedule whose name is longer than the value of a label may be", () => {
    expect(scheduleRefused("s".repeat(63))).toBeUndefined();
    expect(scheduleRefused("s".repeat(64))).toBe(
      "The schedule has a name of 64 characters: every backup of a schedule carries its name as the value of the label velero.io/schedule-name, which the API server refuses above 63 characters.",
    );
  });
});

describe("the backup the release makes from a schedule", () => {
  it("takes the template whole as its spec, in the namespace of the schedule, with nothing of its status", () => {
    const read = schedule();
    const body = backupFromSchedule(read, "daily-20261108034105");

    expect(body).toEqual({
      apiVersion: "velero.io/v1",
      kind: "Backup",
      metadata: { name: "daily-20261108034105", namespace: "velero", labels: { [SCHEDULE_NAME_LABEL]: "daily" } },
      spec: read.spec.template,
    });
    // A copy: the schedule read is left as it was.
    expect(body?.spec).not.toBe(read.spec.template);
    expect(read).toEqual(schedule());
  });

  it("takes the labels of the template when it has a map of them, even an empty one, else the ones of the schedule, never both", () => {
    const labelled = { labels: { team: "shop", [SCHEDULE_NAME_LABEL]: "another" } };
    const labels = (template: Record<string, unknown>) =>
      backupFromSchedule(
        schedule({ metadata: labelled, spec: { template: { storageLocation: "default", ...template } } }),
        "b",
      )?.metadata.labels;

    expect(labels({ metadata: { labels: { app: "cart" } } })).toEqual({ app: "cart", [SCHEDULE_NAME_LABEL]: "daily" });
    expect(labels({ metadata: { labels: {} } })).toEqual({ [SCHEDULE_NAME_LABEL]: "daily" });
    // No map of labels in the template, and a template with metadata but no labels: the ones of the schedule, with the
    // label of the schedule set to its name whatever it held.
    expect(labels({})).toEqual({ team: "shop", [SCHEDULE_NAME_LABEL]: "daily" });
    expect(labels({ metadata: {} })).toEqual({ team: "shop", [SCHEDULE_NAME_LABEL]: "daily" });
    expect(labels({ metadata: { labels: null } })).toEqual({ team: "shop", [SCHEDULE_NAME_LABEL]: "daily" });
    // The template keeps its own metadata in the spec, as the release copies it, with the label of the schedule the
    // builder sets in the map of the template; a template without that map keeps its metadata as it is.
    expect(
      backupFromSchedule(schedule({ spec: { template: { metadata: { labels: { app: "cart" } } } } }), "b")?.spec,
    ).toEqual({ metadata: { labels: { app: "cart", [SCHEDULE_NAME_LABEL]: "daily" } } });
    expect(backupFromSchedule(schedule({ spec: { template: { metadata: {} } } }), "b")?.spec).toEqual({ metadata: {} });
  });

  it("takes the annotations of the schedule, and none when it has none", () => {
    const annotations = { "example.test/owner": "team-shop" };

    expect(backupFromSchedule(schedule({ metadata: { annotations } }), "b")?.metadata.annotations).toEqual(annotations);
    expect(backupFromSchedule(schedule({ metadata: { annotations: {} } }), "b")?.metadata).not.toHaveProperty(
      "annotations",
    );
    expect(backupFromSchedule(schedule(), "b")?.metadata).not.toHaveProperty("annotations");
  });

  it("names the schedule its controlling owner only with useOwnerReferencesInBackup true", () => {
    const owned = (use: unknown) =>
      backupFromSchedule(
        schedule({ spec: { useOwnerReferencesInBackup: use, template: { storageLocation: "default" } } }),
        "b",
      )?.metadata.ownerReferences;

    expect(owned(true)).toEqual([
      {
        apiVersion: "velero.io/v1",
        kind: "Schedule",
        name: "daily",
        uid: "5b0c2f6e-3f6a-4d2b-9a43-0c1d2e3f4a5b",
        controller: true,
      },
    ]);
    for (const use of [false, null, undefined, "true"]) expect([use, owned(use)]).toEqual([use, undefined]);
  });

  it("writes the resource policy of the template as a reference of the kind configmap", () => {
    const policy = (resourcePolicy: unknown) =>
      backupFromSchedule(schedule({ spec: { template: { resourcePolicy } } }), "b")?.spec.resourcePolicy;

    expect(policy({ apiGroup: "v1", kind: "ConfigMap", name: "skip-large" })).toEqual({
      kind: "configmap",
      name: "skip-large",
    });
    expect(policy(null)).toBeNull();
    expect(backupFromSchedule(schedule({ spec: { template: {} } }), "b")?.spec).toEqual({});
  });

  it("makes no backup of a schedule read without its name, its namespace or its UID", () => {
    for (const metadata of [{ name: "" }, { namespace: undefined }, { uid: 7 }]) {
      expect([metadata, backupFromSchedule(schedule({ metadata }), "b")]).toEqual([metadata, undefined]);
    }
    expect(backupFromSchedule(null, "b")).toBeUndefined();
    expect(backupFromSchedule({ metadata: "daily" }, "b")).toBeUndefined();
    // A schedule with no spec makes a backup of an empty template, as the release does.
    expect(backupFromSchedule({ metadata: schedule().metadata }, "b")?.spec).toEqual({});
  });
});

// What the types of the command line print that the API server and the release read as not set: the zero values of
// its durations, an empty object and a null, where the schedule has nothing. A body leaves them out.
function withoutZeros(printed: unknown, read: unknown): unknown {
  if (Array.isArray(printed)) {
    return printed.map((item, index) => withoutZeros(item, Array.isArray(read) ? read[index] : undefined));
  }
  if (printed === null || typeof printed !== "object") return printed;
  const source =
    read !== null && typeof read === "object" && !Array.isArray(read) ? (read as Record<string, unknown>) : {};
  const kept: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(printed)) {
    const empty =
      value === "0s" ||
      value === null ||
      (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length);

    if (!(key in source) && empty) continue;
    kept[key] = withoutZeros(value, source[key]);
  }
  return kept;
}

describe("the backup of the command line of the release", () => {
  it.each(Object.entries(goldens.cases))("is the body built from the schedule: %s", (_, { name, schedule, backup }) => {
    const { creationTimestamp, ...metadata } = backup.metadata as Record<string, unknown>;
    const { status, ...printed } = backup as Record<string, unknown>;

    // What the command line prints of an object it has not created: no time of its creation, and an empty status.
    expect([creationTimestamp, status]).toEqual([null, {}]);
    expect(backupFromSchedule(schedule, name)).toEqual(
      withoutZeros({ ...printed, metadata }, { metadata, spec: schedule.spec.template }),
    );
  });
});

describe("the text of the body", () => {
  it("is written with two spaces and the keys of an object first, the others by their characters, whatever the order read", () => {
    const one = backupFromSchedule(
      schedule({ spec: { template: { ttl: "1h0m0s", includedNamespaces: ["b", "a"], csiSnapshotTimeout: "10m" } } }),
      "b",
    );
    const other = backupFromSchedule(
      schedule({ spec: { template: { csiSnapshotTimeout: "10m", includedNamespaces: ["b", "a"], ttl: "1h0m0s" } } }),
      "b",
    );

    expect(one && other && bodyText(one)).toBe(other && bodyText(other));
    expect(one && bodyText(one)).toBe(
      [
        "{",
        '  "apiVersion": "velero.io/v1",',
        '  "kind": "Backup",',
        '  "metadata": {',
        '    "name": "b",',
        '    "namespace": "velero",',
        '    "labels": {',
        `      "${SCHEDULE_NAME_LABEL}": "daily"`,
        "    }",
        "  },",
        '  "spec": {',
        '    "csiSnapshotTimeout": "10m",',
        '    "includedNamespaces": [',
        '      "b",',
        '      "a"',
        "    ],",
        '    "ttl": "1h0m0s"',
        "  }",
        "}",
      ].join("\n"),
    );
  });
});

describe("what the review of a backup asked from a schedule says", () => {
  const meaning = (read: unknown) => {
    const body = backupFromSchedule(read, "daily-20261108034105");

    return body ? backupFromScheduleMeaning(read, body) : [];
  };

  it("says that it is asked by hand and moves nothing, the queue, the hold of the submissions, the restore and the validation", () => {
    expect(meaning(schedule())).toEqual([
      { id: "by-hand", words: MEANING_WORDS.byHand },
      { id: "queue", words: MEANING_WORDS.queue },
      { id: "hold", words: MEANING_WORDS.hold },
      { id: "restore", words: MEANING_WORDS.restore },
      { id: "validation", words: MEANING_WORDS.validation },
      {
        id: `label:${SCHEDULE_NAME_LABEL}`,
        words:
          "velero.io/schedule-name: daily. Velero finds the backups of the schedule by this label, for the hold of its submissions and for a restore from the schedule.",
      },
    ]);
    expect(MEANING_WORDS.byHand).toBe(
      "The backup is asked by hand and is not a submission of the schedule: it moves nothing in the schedule, whose next run stays where it is.",
    );
    expect(MEANING_WORDS.hold).toContain(
      "a run that falls due meanwhile is submitted once, at the first look after it",
    );
    expect(MEANING_WORDS.hold).toContain("Queued and ReadyToStart do not hold it");
  });

  it("says that a paused schedule and one that failed its validation make the backup all the same", () => {
    const ids = (read: unknown) => meaning(read).map(({ id }) => id);
    const paused = schedule({ spec: { paused: true, template: { includedNamespaces: ["shop"] } } });
    const refused = { ...schedule(), status: { phase: "FailedValidation", validationErrors: ["invalid schedule"] } };

    expect(ids(paused)).toContain("paused");
    expect(ids(paused)).not.toContain("refused");
    expect(ids(refused)).toContain("refused");
    expect(ids(schedule())).not.toContain("paused");
    expect(MEANING_WORDS.refused).toContain("which Velero validates when the backup starts");
  });

  it("says that deleting the schedule deletes the backup only when the schedule owns it", () => {
    const owned = schedule({ spec: { useOwnerReferencesInBackup: true, template: {} } });

    expect(meaning(owned).find(({ id }) => id === "owner")?.words).toBe(MEANING_WORDS.owner);
    expect(meaning(schedule()).some(({ id }) => id === "owner")).toBe(false);
  });

  it("names each label and annotation the backup takes from the schedule, by its key, and where it comes from", () => {
    const labelled = schedule({
      metadata: { labels: { team: "shop" }, annotations: { "example.test/owner": "team-shop" } },
    });
    const fromTemplate = schedule({ spec: { template: { metadata: { labels: { app: "cart" } } } } });

    expect(meaning(labelled).slice(5)).toEqual([
      {
        id: `label:${SCHEDULE_NAME_LABEL}`,
        words: MEANING_WORDS.scheduleLabel("daily"),
      },
      { id: "label:team", words: "team: shop, from the labels of the schedule." },
      {
        id: "annotation:example.test/owner",
        words: "The annotation example.test/owner, from the annotations of the schedule.",
      },
    ]);
    expect(meaning(fromTemplate).find(({ id }) => id === "label:app")?.words).toBe(
      "app: cart, from the labels of the template of the schedule.",
    );
  });
});
