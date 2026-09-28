import { describe, expect, it } from "vitest";
import {
  accessMode,
  accessNote,
  availabilityMark,
  availabilityState,
  awsBackend,
  configEntries,
  defaults,
  defaultsNote,
  encodedBytes,
  frequencyNote,
  frequencyText,
  LATE_AT_LEAST,
  LATE_VALIDATIONS,
  LATE_WITHOUT_FREQUENCY,
  lateAfter,
  lateNote,
  MAY_BE_OUT_OF_DATE,
  NEVER_SYNCED,
  NEVER_VALIDATED,
  referenceText,
  SNAPSHOT_PHASE_NOTE,
  shownText,
  shownValue,
  snapshotLocationView,
  storageLocationView,
  syncNote,
  syncSummary,
  syncText,
  TLS_NOT_VERIFIED,
  TLS_NOT_VERIFIED_BY_RESTIC,
  validation,
  validationAge,
  validationFrequency,
  validationSummary,
} from "./location-view";

import type { BackupStorageLocationResource, VolumeSnapshotLocationResource } from "./types";

const now = Date.parse("2026-09-01T12:00:00Z");
const ago = (milliseconds: number) => new Date(now - milliseconds).toISOString().replace(".000Z", "Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// What the host hands over is plain data that the extension does not own: no helper may change it.
function frozen<Value>(value: Value): Value {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) frozen(inner);
    Object.freeze(value);
  }
  return value;
}

function location(
  spec: BackupStorageLocationResource["spec"],
  status?: BackupStorageLocationResource["status"],
  name = "default",
  namespace = "velero-demo",
): BackupStorageLocationResource {
  return frozen({
    metadata: { name, namespace, uid: `uid-${name}`, creationTimestamp: "2026-08-01T00:00:00Z" },
    ...(spec === undefined ? {} : { spec }),
    ...(status === undefined ? {} : { status }),
  });
}

describe("availability of a location", () => {
  it.each([
    ["Available", "available", "Available"],
    ["Unavailable", "unavailable", "Unavailable"],
  ])("reads %s as the release writes it", (phase, availability, label) => {
    expect(availabilityState(phase)).toEqual({ reported: phase, availability, label });
  });

  it.each([undefined, null, "", 0, true, {}, ["Available"]])("reads a phase of %j as not reported", (phase) => {
    const state = availabilityState(phase);

    expect(state).toEqual({ availability: "not-reported", label: "Not reported" });
    expect("reported" in state).toBe(false);
  });

  it.each(["available", "Ready", "Degraded", " Available", "New"])(
    "keeps the text of %j, a phase it does not know, and does not call it available",
    (phase) => {
      expect(availabilityState(phase)).toEqual({
        reported: phase,
        availability: "unknown",
        label: `Unknown: ${phase}`,
      });
    },
  );

  it("marks as available a reported Available of a storage location, and nothing else", () => {
    expect(availabilityMark(availabilityState("Available"), "storage")).toBe("available");
    expect(availabilityMark(availabilityState("Unavailable"), "storage")).toBe("unavailable");
    for (const phase of [undefined, "", "Ready", "available"]) {
      expect(availabilityMark(availabilityState(phase), "storage")).toBe("unknown");
    }
  });

  // Nothing of the reviewed release writes or checks the phase of a snapshot location.
  it("gives the phase of a snapshot location the mark of what is not known, whatever it says", () => {
    for (const phase of ["Available", "Unavailable", undefined, "Ready"]) {
      expect(availabilityMark(availabilityState(phase), "snapshot")).toBe("unknown");
    }
    expect(SNAPSHOT_PHASE_NOTE).toContain("neither writes nor checks");
  });

  it("shows the message of Velero beside the phase, and none where none is", () => {
    const failing = storageLocationView(
      location({ provider: "aws" }, { phase: "Unavailable", message: "a synthetic failure\nof two lines" }),
      now,
    );

    expect(failing.availability.availability).toBe("unavailable");
    expect(failing.message).toBe("a synthetic failure\nof two lines");
    expect(storageLocationView(location({ provider: "aws" }, { phase: "Unavailable" }), now).message).toBeUndefined();
    expect(storageLocationView(location({ provider: "aws" }, { phase: "Unavailable", message: "" }), now).message).toBe(
      undefined,
    );
  });
});

describe("last validation of a storage location", () => {
  it("has two distances after which an availability may be out of date, in one place", () => {
    expect(LATE_VALIDATIONS).toBe(3);
    expect(LATE_WITHOUT_FREQUENCY).toBe(HOUR);
    // The release looks for what is due every ten seconds, and the views read every fifteen.
    expect(LATE_AT_LEAST).toBe(MINUTE);
    expect(lateAfter(validationFrequency("1m0s"))).toBe(3 * MINUTE);
    expect(lateAfter(validationFrequency("5s"))).toBe(MINUTE);
    expect(lateAfter(validationFrequency("20s"))).toBe(MINUTE);
    expect(lateAfter(validationFrequency("21s"))).toBe(63_000);
    expect(lateAfter(validationFrequency("0s"))).toBe(HOUR);
    expect(lateAfter(validationFrequency(undefined))).toBe(HOUR);
  });

  it.each([
    ["1m0s", { of: "location", milliseconds: MINUTE, written: "1m0s" }],
    ["30s", { of: "location", milliseconds: 30_000, written: "30s" }],
    ["0s", { of: "off", written: "0s" }],
    ["0", { of: "off", written: "0" }],
    [undefined, { of: "server" }],
    [null, { of: "server" }],
    ["", { of: "server" }],
    // One that is below zero or that cannot be read is treated as one that is not named.
    ["-1m", { of: "server", written: "-1m" }],
    ["soon", { of: "server", written: "soon" }],
    [60, { of: "server", written: "60" }],
  ])("reads the frequency %j", (written, frequency) => {
    expect(validationFrequency(written)).toEqual(frequency);
  });

  it.each([
    // A frequency and a fresh validation, then an old one: three times the frequency is the bound.
    ["1m0s", 30_000, false],
    ["1m0s", 3 * MINUTE, false],
    ["1m0s", 3 * MINUTE + 1, true],
    ["1h0m0s", 2 * HOUR, false],
    ["1h0m0s", 3 * HOUR + 1000, true],
    // A frequency of seconds: a location validated in time is not late between two reads of the views.
    ["5s", 16_000, false],
    ["5s", MINUTE, false],
    ["5s", MINUTE + 1, true],
    // Turned off, and not named: one hour is the bound.
    ["0s", 59 * MINUTE, false],
    ["0s", HOUR + 1, true],
    [undefined, 5 * MINUTE, false],
    [undefined, HOUR, false],
    [undefined, HOUR + 1, true],
    // One that cannot be read is one that is not named.
    ["soon", HOUR + 1, true],
    ["-5m", 20 * MINUTE, false],
  ])("with a frequency of %j and a validation %i ms old, says late: %j", (frequency, age, late) => {
    const state = validation(
      location({ validationFrequency: frequency as never }, { phase: "Available", lastValidationTime: ago(age) }),
      now,
    );

    expect(state.at).toBe(now - age);
    expect(state.age).toBe(age);
    expect(state.late).toBe(late);
    expect(lateNote(state) !== "").toBe(late);
  });

  it("says which of the two bounds was passed", () => {
    const named = validation(
      location({ validationFrequency: "1m0s" }, { phase: "Available", lastValidationTime: ago(HOUR) }),
      now,
    );
    const unnamed = validation(location({}, { phase: "Available", lastValidationTime: ago(2 * HOUR) }), now);

    const quick = validation(
      location({ validationFrequency: "5s" }, { phase: "Available", lastValidationTime: ago(2 * MINUTE) }),
      now,
    );

    // Each says which bound it is, and whose clock the age is counted by.
    expect(lateNote(named)).toBe(
      "The availability may be out of date: the last validation is older than 3 times the frequency, by the clock of this machine.",
    );
    expect(lateNote(unnamed)).toBe(
      "The availability may be out of date: the last validation is older than one hour, by the clock of this machine.",
    );
    expect(lateNote(quick)).toBe(
      "The availability may be out of date: the last validation is older than one minute, by the clock of this machine.",
    );
  });

  it("says never validated of a phase with no validation time, and makes up no age", () => {
    for (const status of [{ phase: "Available" }, { phase: "Available", lastValidationTime: null }, {}, undefined]) {
      const state = validation(location({ validationFrequency: "1m0s" }, status as never), now);

      expect(state.at).toBeUndefined();
      expect(state.age).toBeUndefined();
      expect(state.late).toBe(false);
    }
    expect(
      validation(location({}, { phase: "Available", lastValidationTime: "yesterday" as never }), now).at,
    ).toBeUndefined();
  });

  it("says how long ago the last validation was, and nothing of one that is not reported", () => {
    const state = (age: number) => validation(location({}, { phase: "Available", lastValidationTime: ago(age) }), now);

    expect(validationAge(state(30_000))).toBe("30s ago");
    expect(validationAge(state(3 * HOUR + 5 * MINUTE))).toBe("3h 5m ago");
    expect(validationAge(state(49 * HOUR))).toBe("2d 1h ago");
    expect(validationAge(state(0))).toBe("0s ago");
    expect(validationAge(validation(location({}, { phase: "Available" }), now))).toBe("");
    expect(NEVER_VALIDATED).toBe("Never validated");
  });

  it("says in a list how long ago a location was validated, and that what it reports may not hold", () => {
    const state = (age: number, frequency?: string) =>
      validation(
        location({ validationFrequency: frequency }, { phase: "Available", lastValidationTime: ago(age) }),
        now,
      );

    expect(validationSummary(state(30_000, "1m0s"))).toBe("30s ago");
    expect(validationSummary(state(4 * MINUTE, "1m0s"))).toBe("4m ago, may be out of date");
    expect(validationSummary(state(59 * MINUTE))).toBe("59m ago");
    expect(validationSummary(state(49 * HOUR))).toBe("2d 1h ago, may be out of date");
    expect(validationSummary(validation(location({}, { phase: "Available" }), now))).toBe("Never validated");
    expect(MAY_BE_OUT_OF_DATE).toBe("may be out of date");
  });

  it("does not count below zero the age of a validation the clock of the desktop is behind of", () => {
    const state = validation(
      location({ validationFrequency: "1m0s" }, { phase: "Available", lastValidationTime: ago(-5 * MINUTE) }),
      now,
    );

    expect(state.age).toBe(0);
    expect(state.late).toBe(false);
  });

  it("says in words what the frequency is, and whose it is when the location names none", () => {
    expect(frequencyText(validationFrequency("1m0s"))).toBe("Every 1m0s");
    expect(frequencyNote(validationFrequency("1m0s"))).toBe("");
    expect(frequencyText(validationFrequency("0s"))).toBe("Turned off");
    expect(frequencyNote(validationFrequency("0s"))).toBe(
      "The periodic validation is turned off: the availability is the one of the last validation.",
    );
    expect(frequencyText(validationFrequency(undefined))).toBe("Not set");
    expect(frequencyNote(validationFrequency(undefined))).toBe(
      "The frequency is the one of the server of Velero, which this view does not read.",
    );
    expect(frequencyText(validationFrequency("soon"))).toBe("Not read: soon");
    expect(frequencyNote(validationFrequency("soon"))).toContain("not a frequency the release takes");
  });
});

describe("access mode of a storage location", () => {
  it.each([
    ["ReadWrite", "ReadWrite", "Read and write"],
    ["ReadOnly", "ReadOnly", "Read only"],
    ["readonly", "unknown", "Unknown: readonly"],
    ["WriteOnly", "unknown", "Unknown: WriteOnly"],
  ])("reads the mode %j of the spec", (written, mode, label) => {
    expect(accessMode(location({ accessMode: written }))).toEqual({ mode, written, label });
  });

  it("says not set of a mode that is not set, with what the release refuses a backup for", () => {
    for (const spec of [{}, { accessMode: "" }, { accessMode: null as never }, undefined]) {
      const access = accessMode(location(spec as never));

      expect(access).toEqual({ mode: "not-set", label: "Not set" });
      expect(accessNote(access, availabilityState("Available"))).toBe(
        "The release refuses a backup for the access mode only when it is read-only.",
      );
    }
  });

  // The field of the status is deprecated and unused in the reviewed release.
  it("never reads the mode of the status for the mode of the location", () => {
    const disagreeing = location({ accessMode: "ReadWrite" }, { phase: "Available", accessMode: "ReadOnly" });
    const only = location({}, { phase: "Available", accessMode: "ReadOnly" });

    expect(accessMode(disagreeing).mode).toBe("ReadWrite");
    expect(accessMode(only).mode).toBe("not-set");
    expect(JSON.stringify(storageLocationView(only, now))).not.toContain("ReadOnly");
  });

  it("says of a location that is available and read only that it does not take new backups", () => {
    const access = accessMode(location({ accessMode: "ReadOnly" }));

    expect(accessNote(access, availabilityState("Available"))).toBe(
      "The location is available and read-only: it does not take new backups.",
    );
    expect(accessNote(access, availabilityState("Unavailable"))).toBe(
      "The release refuses a backup sent to a location that is read-only.",
    );
    expect(accessNote(accessMode(location({ accessMode: "ReadWrite" })), availabilityState("Available"))).toBe("");
  });
});

describe("default of an installation", () => {
  const marked = (name: string, namespace = "velero-demo") => location({ default: true }, undefined, name, namespace);
  const plain = (name: string, namespace = "velero-demo") => location({}, undefined, name, namespace);

  it("is what the spec marks, and the view picks none", () => {
    expect(defaults([marked("default"), plain("archive")], "velero-demo")).toEqual({
      state: "one",
      names: ["default"],
    });
    expect(defaultsNote(defaults([marked("default")], "velero-demo"))).toBe("");
    expect(storageLocationView(marked("default"), now).marked).toBe(true);
    expect(storageLocationView(plain("archive"), now).marked).toBe(false);
    for (const value of ["true", 1, null, undefined]) {
      expect(storageLocationView(location({ default: value as never }), now).marked).toBe(false);
    }
  });

  it("says that none is marked, and that the server may name one the view does not read", () => {
    const none = defaults([plain("first"), plain("second")], "velero-demo");

    expect(none).toEqual({ state: "none", names: [] });
    expect(defaultsNote(none)).toBe(
      "No storage location of this installation is marked default. The server of Velero may name one in its settings, which this view does not read.",
    );
    expect(defaults([], "velero-demo")).toEqual({ state: "none", names: [] });
  });

  it("shows each of the ones that are marked, and says which one the release keeps", () => {
    const at = (name: string, created: string | undefined): BackupStorageLocationResource =>
      frozen({
        metadata: { name, namespace: "velero-demo", uid: `uid-${name}`, creationTimestamp: created },
        spec: { default: true },
      });
    const many = defaults(
      [at("second", "2026-08-02T00:00:00Z"), plain("archive"), at("first", "2026-08-03T00:00:00Z")],
      "velero-demo",
    );

    // Each is named, by name, and the one the release keeps is the one created last: the view picks none.
    expect(many).toEqual({ state: "many", names: ["first", "second"], kept: "first" });
    expect(defaultsNote(many)).toBe(
      "2 storage locations are marked default: first, second. The reviewed release sends a backup that names no location to the first of them it finds, and keeps marked the one created last, which is first.",
    );
    expect(
      defaults([at("first", "2026-08-02T00:00:00Z"), at("second", "2026-08-03T00:00:00Z")], "velero-demo"),
    ).toMatchObject({ kept: "second" });
    // One whose time of creation is not read is older than every other.
    expect(defaults([at("first", "2026-08-02T00:00:00Z"), at("second", undefined)], "velero-demo")).toMatchObject({
      kept: "first",
    });
  });

  it("does not say which one the release keeps of the ones created in the same second", () => {
    const at = (name: string, created: string | undefined): BackupStorageLocationResource =>
      frozen({
        metadata: { name, namespace: "velero-demo", uid: `uid-${name}`, creationTimestamp: created },
        spec: { default: true },
      });
    // The release keeps the first of the list it is answered with, which the view does not know.
    const tied = defaults(
      [at("second", "2026-08-02T00:00:00Z"), at("first", "2026-08-02T00:00:00Z"), at("old", "2026-08-01T00:00:00Z")],
      "velero-demo",
    );

    expect(tied).toEqual({ state: "many", names: ["first", "old", "second"], tied: ["first", "second"] });
    expect("kept" in tied).toBe(false);
    expect(defaultsNote(tied)).toBe(
      "3 storage locations are marked default: first, old, second. The reviewed release sends a backup that names no location to the first of them it finds, and keeps marked the one created last: first and second were created in the same second, and which of them it keeps is not settled.",
    );
    // None of them has a time that is read: they are as old as each other.
    expect(defaults([at("b", undefined), at("a", "soon")], "velero-demo")).toMatchObject({ tied: ["a", "b"] });
    // The same order on every machine: by the characters of the names.
    expect(
      defaults(
        [at("b", "2026-08-02T00:00:00Z"), at("B", "2026-08-02T00:00:00Z"), at("a", "2026-08-02T00:00:00Z")],
        "velero-demo",
      ).names,
    ).toEqual(["B", "a", "b"]);
  });

  it("does not count the locations of another installation", () => {
    expect(defaults([marked("default"), marked("default", "velero-other")], "velero-demo")).toEqual({
      state: "one",
      names: ["default"],
    });
  });
});

describe("where a location points", () => {
  it("shows the provider, the bucket, the prefix and every key of the configuration as the object carries them", () => {
    const view = storageLocationView(
      location({
        provider: "aws",
        objectStorage: { bucket: "backups", prefix: "cluster-a" },
        config: { region: "eu-south-1", s3ForcePathStyle: "true", s3Url: "https://storage.example.test:9000" },
        validationFrequency: "1m0s",
        backupSyncPeriod: "5m0s",
      }),
      now,
    );

    expect([view.provider, view.bucket, view.prefix]).toEqual(["aws", "backups", "cluster-a"]);
    expect(view.config).toEqual([
      { key: "region", value: "eu-south-1", shortened: false },
      { key: "s3ForcePathStyle", value: "true", shortened: false },
      { key: "s3Url", value: "https://storage.example.test:9000", shortened: false },
    ]);
    expect(syncText(view.sync)).toBe("Every 5m0s");
  });

  it("has no configuration for a location that carries none", () => {
    for (const config of [undefined, null, {}, [], "region=eu", 7]) {
      expect(configEntries(config, "aws")).toEqual([]);
    }
    const bare = storageLocationView(frozen({ metadata: { name: "bare" } }) as BackupStorageLocationResource, now);

    expect(bare.config).toEqual([]);
    expect([bare.provider, bare.bucket, bare.prefix, bare.credential]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(JSON.stringify(bare)).not.toMatch(/NaN|Infinity/);
  });

  it.each([
    ["https://storage.example.test", "https://storage.example.test", false],
    ["https://storage.example.test:9000/bucket", "https://storage.example.test:9000/bucket", false],
    ["https://user:synthetic@storage.example.test/bucket", "https://storage.example.test/bucket", true],
    ["https://user@storage.example.test", "https://storage.example.test", true],
    ["https://storage.example.test/bucket?X-Signature=synthetic&x=1", "https://storage.example.test/bucket", true],
    ["https://a:b@storage.example.test/p?token=synthetic#part", "https://storage.example.test/p", true],
    ["s3://key:synthetic@bucket/prefix", "s3://bucket/prefix", true],
    // A password that holds what ends an authority: everything before the last at sign goes.
    ["https://user:syn/thetic@storage.example.test/bucket", "https://storage.example.test/bucket", true],
    ["https://user:syn?thetic@storage.example.test/bucket?x=1", "https://storage.example.test/bucket", true],
    ["https://user:syn#thetic@storage.example.test", "https://storage.example.test", true],
    ["https://user:synthetic@inner@storage.example.test/b", "https://storage.example.test/b", true],
    // An address that names no scheme.
    ["//user:synthetic@storage.example.test/bucket", "//storage.example.test/bucket", true],
    ["//storage.example.test/bucket", "//storage.example.test/bucket", false],
    // An at sign of a path is of the path, where the authority holds no colon.
    ["http://storage.example.test/path/with@sign", "http://storage.example.test/path/with@sign", false],
    ["eu-south-1", "eu-south-1", false],
    ["user@example.test", "user@example.test", false],
    ["true", "true", false],
    ["", "", false],
  ])("shows %j as %j", (written, value, shortened) => {
    expect(shownValue(written)).toEqual({ value, shortened });
    expect(shownValue(written).value).not.toContain("synthetic");
  });

  it("shows an address that a text quotes as a value that reads as one", () => {
    expect(
      shownText(
        'Get "https://user:synthetic@storage.example.test/bucket?X-Signature=synthetic": dial tcp: no such host',
      ),
    ).toEqual({ value: 'Get "https://storage.example.test/bucket": dial tcp: no such host', shortened: true });
    expect(shownText("first http://a.example.test/x then s3://key:synthetic@b/y.")).toEqual({
      value: "first http://a.example.test/x then s3://b/y.",
      shortened: true,
    });
    // A text that quotes none, and one whose address hides nothing, are as they were written.
    for (const text of ["the bucket does not exist", "two lines\nof text", "see https://storage.example.test/b", ""]) {
      expect(shownText(text)).toEqual({ value: text, shortened: false });
    }
    const view = storageLocationView(
      location({}, { phase: "Unavailable", message: "cannot reach https://u:synthetic@storage.example.test" }),
      now,
    );

    expect([view.message, view.messageShortened]).toEqual(["cannot reach https://storage.example.test", true]);
    expect(storageLocationView(location({}, { phase: "Unavailable" }), now)).toMatchObject({
      messageShortened: false,
    });
    expect("message" in storageLocationView(location({}, { phase: "Unavailable" }), now)).toBe(false);
  });

  it("marks in words the verification of TLS turned off, for every value the release reads as true", () => {
    const off = configEntries({ insecureSkipTLSVerify: "true", region: "eu" }, "aws");

    expect(off.find((entry) => entry.key === "insecureSkipTLSVerify")).toEqual({
      key: "insecureSkipTLSVerify",
      value: "true",
      shortened: false,
      mark: "The verification of TLS is turned off",
    });
    expect(off.find((entry) => entry.key === "region")?.mark).toBeUndefined();
    // The release parses the text as Go parses a boolean.
    for (const value of ["1", "t", "T", "TRUE", "true", "True"]) {
      expect([value, configEntries({ insecureSkipTLSVerify: value }, "aws")[0].mark]).toEqual([
        value,
        TLS_NOT_VERIFIED,
      ]);
    }
    for (const value of ["false", "0", "f", "F", "FALSE", "False", "yes", "on", "tRuE", " true", "", "2"]) {
      expect([value, configEntries({ insecureSkipTLSVerify: value }, "aws")[0].mark]).toEqual([value, undefined]);
    }
    // What is not a text is not what the release is given: a configuration holds texts.
    expect(configEntries({ insecureSkipTLSVerify: true }, "aws")[0].mark).toBe(TLS_NOT_VERIFIED);
    expect(configEntries({ insecureSkipTLSVerify: 1 }, "aws")[0].mark).toBe(TLS_NOT_VERIFIED);
  });

  it("knows the backend the release takes for the one of AWS, and says what the key does with another", () => {
    const mark = (provider: string | undefined, more: object = {}) =>
      configEntries({ insecureSkipTLSVerify: "true", ...more }, provider).find(
        (entry) => entry.key === "insecureSkipTLSVerify",
      )?.mark;

    // The provider of that name, with the group of Velero or without it.
    expect(mark("aws")).toBe(TLS_NOT_VERIFIED);
    expect(mark("velero.io/aws")).toBe(TLS_NOT_VERIFIED);
    // A provider the release does not know whose configuration names an address of S3.
    expect(mark("example.io/object-store", { s3Url: "https://storage.example.test" })).toBe(TLS_NOT_VERIFIED);
    expect(mark("other", { s3Url: "https://storage.example.test" })).toBe(TLS_NOT_VERIFIED);
    expect(awsBackend(undefined, { s3Url: "https://storage.example.test" })).toBe(true);
    // The ones it knows are what they are, whatever their configuration names.
    for (const provider of ["gcp", "velero.io/gcp", "azure", "velero.io/azure", "velero.io/fs"]) {
      expect([provider, mark(provider, { s3Url: "https://storage.example.test" })]).toEqual([
        provider,
        TLS_NOT_VERIFIED_BY_RESTIC,
      ]);
    }
    // With another backend the release reads the key for what it moves with restic.
    expect(mark("gcp")).toBe(TLS_NOT_VERIFIED_BY_RESTIC);
    expect(mark("example.io/object-store")).toBe(TLS_NOT_VERIFIED_BY_RESTIC);
    expect(mark(undefined)).toBe(TLS_NOT_VERIFIED_BY_RESTIC);
    expect(mark("other", { s3Url: "" })).toBe(TLS_NOT_VERIFIED_BY_RESTIC);
    expect(TLS_NOT_VERIFIED_BY_RESTIC).toContain("restic");
  });

  it("says how long ago the backups of a location were last synced, and never of a sync that is not there", () => {
    const synced = (status: object | undefined) => storageLocationView(location({}, status as never), now).sync;

    expect(synced({ phase: "Available", lastSyncedTime: ago(90_000) })).toMatchObject({
      last: now - 90_000,
      age: 90_000,
    });
    expect(syncSummary(synced({ lastSyncedTime: ago(90_000) }))).toBe("1m 30s ago");
    expect(syncSummary(synced({ lastSyncedTime: ago(26 * HOUR) }))).toBe("1d 2h ago");
    // A sync the clock of the desktop is behind of is not counted below zero.
    expect(synced({ lastSyncedTime: ago(-5 * MINUTE) }).age).toBe(0);
    expect(syncSummary(synced({ lastSyncedTime: ago(-5 * MINUTE) }))).toBe("0s ago");
    for (const status of [undefined, {}, { lastSyncedTime: null }, { lastSyncedTime: "yesterday" }]) {
      expect("age" in synced(status)).toBe(false);
      expect(syncSummary(synced(status))).toBe("Never synced");
    }
    expect(NEVER_SYNCED).toBe("Never synced");
  });

  it("says sync turned off of a period of zero, and never synced is a last sync that is not there", () => {
    const view = storageLocationView(location({ backupSyncPeriod: "0s" }, { phase: "Available" }), now);
    const period = (written: string | undefined) =>
      storageLocationView(location({ backupSyncPeriod: written }), now).sync;

    expect(syncText(view.sync)).toBe("Turned off");
    expect(syncNote(view.sync)).toBe("The sync of the backups of this location is turned off.");
    expect(view.sync.last).toBeUndefined();
    expect([syncText(period("5m0s")), syncNote(period("5m0s"))]).toEqual(["Every 5m0s", ""]);
    expect(syncText(storageLocationView(location({}), now).sync)).toBe("Not set");
    expect(syncNote(period(undefined))).toBe(
      "The period is the one of the server of Velero, which this view does not read.",
    );
    expect(syncText(storageLocationView(location({ backupSyncPeriod: "often" }), now).sync)).toBe("Not read: often");
    // A period below zero is not one the release takes: it is not shown as one it syncs by.
    for (const written of ["-1m", "often"]) {
      expect(syncText(period(written))).toBe(`Not read: ${written}`);
      expect(syncNote(period(written))).toBe(
        "This is not a period the release takes: it uses the one of its server, which this view does not read.",
      );
    }
    expect(
      storageLocationView(location({}, { phase: "Available", lastSyncedTime: "2026-09-01T11:59:00Z" }), now).sync.last,
    ).toBe(Date.parse("2026-09-01T11:59:00Z"));
  });
});

describe("credentials of a location", () => {
  it("shows a credential and a certificate reference by the name of the Secret and of its key", () => {
    const view = storageLocationView(
      location({
        credential: { name: "cloud-credentials", key: "cloud" },
        objectStorage: { bucket: "backups", caCertRef: { name: "storage-ca", key: "ca.crt" } },
      }),
      now,
    );

    expect(referenceText(view.credential)).toBe("Secret cloud-credentials, key cloud");
    expect(referenceText(view.certificate.reference)).toBe("Secret storage-ca, key ca.crt");
    expect(view.certificate.inline).toBeUndefined();
    expect(referenceText(undefined)).toBe("Not set");
  });

  it("shows a reference that lacks a part as it is", () => {
    expect(referenceText(storageLocationView(location({ credential: { key: "cloud" } }), now).credential)).toBe(
      "a Secret that is not named, key cloud",
    );
    expect(referenceText(storageLocationView(location({ credential: { name: "cloud" } }), now).credential)).toBe(
      "Secret cloud",
    );
    for (const credential of [{}, { name: "" }, null, undefined]) {
      expect(storageLocationView(location({ credential: credential as never }), now).credential).toBeUndefined();
    }
  });

  it("says that an inline certificate is there, with its size, and shows nothing of its content", () => {
    // Twelve bytes, as the API encodes them.
    const encoded = "c3ludGhldGljLWNh";
    const view = storageLocationView(location({ objectStorage: { bucket: "backups", caCert: encoded } }), now);

    expect(view.certificate.inline).toEqual({ bytes: 12 });
    expect(JSON.stringify(view)).not.toContain(encoded);
    expect(JSON.stringify(view)).not.toContain("synthetic-ca");
    expect(encodedBytes("YQ==")).toBe(1);
    expect(encodedBytes("YWI=")).toBe(2);
    expect(encodedBytes("YWJj")).toBe(3);
    expect(encodedBytes("YWJj\nYWJj\n")).toBe(6);
    // What is not an encoding has no size, and is said present all the same.
    expect(encodedBytes("not an encoding!")).toBeUndefined();
    expect(
      storageLocationView(location({ objectStorage: { caCert: "not an encoding!" } }), now).certificate.inline,
    ).toEqual({ bytes: undefined });
    for (const caCert of [undefined, null, ""]) {
      expect(
        storageLocationView(location({ objectStorage: { caCert: caCert as never } }), now).certificate.inline,
      ).toBeUndefined();
    }
  });
});

describe("what the views show of a snapshot location", () => {
  const snapshot = (spec?: object, status?: object): VolumeSnapshotLocationResource =>
    frozen({
      metadata: { name: "snapshots", namespace: "velero-demo", uid: "uid-snapshots" },
      ...(spec ? { spec } : {}),
      ...(status ? { status } : {}),
    }) as VolumeSnapshotLocationResource;

  it("shows the phase as it is written, the provider, the configuration and the credential", () => {
    const view = snapshotLocationView(
      snapshot(
        { provider: "aws", config: { region: "eu-south-1" }, credential: { name: "cloud", key: "snapshots" } },
        { phase: "Available" },
      ),
    );

    expect(view.phase).toEqual({ reported: "Available", availability: "available", label: "Available" });
    expect(availabilityMark(view.phase, "snapshot")).toBe("unknown");
    expect(view.provider).toBe("aws");
    expect(view.config).toEqual([{ key: "region", value: "eu-south-1", shortened: false }]);
    expect(referenceText(view.credential)).toBe("Secret cloud, key snapshots");
  });

  it("says not reported of a snapshot location without a status, which is what the release leaves", () => {
    const view = snapshotLocationView(snapshot({ provider: "aws" }));

    expect(view.phase).toEqual({ availability: "not-reported", label: "Not reported" });
    expect(snapshotLocationView(frozen({ metadata: { name: "bare" } }) as VolumeSnapshotLocationResource)).toEqual({
      name: "bare",
      namespace: "",
      uid: undefined,
      created: undefined,
      phase: { availability: "not-reported", label: "Not reported" },
      provider: undefined,
      config: [],
      credential: undefined,
    });
  });

  // The key of the verification is marked for a storage location: what it does to the snapshots was not read.
  it("marks no key of the configuration of a snapshot location", () => {
    const view = snapshotLocationView(snapshot({ provider: "aws", config: { insecureSkipTLSVerify: "true" } }));

    expect(view.config).toEqual([{ key: "insecureSkipTLSVerify", value: "true", shortened: false }]);
  });

  it("does not change the location it reads", () => {
    expect(() =>
      snapshotLocationView(snapshot({ provider: "aws", config: { insecureSkipTLSVerify: "true" } })),
    ).not.toThrow();
    expect(() =>
      storageLocationView(location({ config: { region: "eu" } }, { phase: "Available" }), now),
    ).not.toThrow();
  });
});
