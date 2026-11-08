import { describe, expect, it } from "vitest";
import {
  FLAG_LABELS,
  reviewZone,
  SCHEDULE_CREATE_VIEW_WORDS,
  scheduleCreateMeaning,
  scheduleResultWords,
  withZonePlaceholder,
} from "./schedule-create-words";
import { scheduleFromForm } from "./schedule-form";

import type { BackupTemplate } from "./backup-template";
import type { ScheduleWrapper } from "./schedule-form";
import type { ServerOffset } from "./schedule-signal";

// The zone of the machine the tests run on is one no case below is computed or written in, fourteen hours east of
// UTC: an instant computed or written in it would fail every case. The module never reads it.
process.env.TZ = "Pacific/Kiritimati";

// Sunday 8 November 2026, 12:00 UTC: 13:00 in Rome.
const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const WRAPPER: ScheduleWrapper = {
  expression: "CRON_TZ=Europe/Rome 0 3 * * *",
  paused: false,
  skipImmediately: false,
  useOwnerReferencesInBackup: false,
};
const OFFSET: ServerOffset = {
  minutes: 60,
  schedule: "daily",
  backup: "daily-20261107030000",
  submission: Date.UTC(2026, 10, 7, 2, 0, 0),
  created: Date.UTC(2026, 10, 7, 2, 0, 1),
};

function body(
  wrapper: Partial<ScheduleWrapper> = {},
  template: BackupTemplate = { storageLocation: "default" },
  now = NOW,
) {
  const made = scheduleFromForm("velero", "nightly-shop", { ...WRAPPER, ...wrapper }, template, now);

  if (!made) throw new Error("The form of the test is refused");
  return made;
}

function said(parts: { id: string; words: string }[]): Record<string, string> {
  return Object.fromEntries(parts.map((part) => [part.id, part.words]));
}

describe("the zone the runs of a schedule of the form are said in", () => {
  it("is the zone the expression names, the offset derived in the installation, none for an interval, or not known", () => {
    expect(reviewZone("CRON_TZ=Europe/Rome 0 3 * * *", OFFSET)).toEqual({
      of: "named",
      zone: { of: "named", name: "Europe/Rome" },
    });
    expect(reviewZone("0 3 * * *", OFFSET)).toEqual({
      of: "derived",
      zone: { of: "fixed", minutes: 60 },
      offset: OFFSET,
      local: false,
    });
    expect(reviewZone("TZ=Local 0 3 * * *", OFFSET)).toMatchObject({ of: "derived", local: true });
    expect(reviewZone("TZ=Local 0 3 * * *", undefined)).toEqual({ of: "not-known", local: true });
    expect(reviewZone("0 3 * * *", undefined)).toEqual({ of: "not-known", local: false });
    expect(reviewZone("@every 6h", undefined)).toEqual({ of: "interval" });
    // An interval needs no zone, whatever the expression names.
    expect(reviewZone("CRON_TZ=Europe/Rome @every 6h", OFFSET)).toEqual({ of: "interval", named: "Europe/Rome" });
    expect(reviewZone("61 * * * *", OFFSET)).toBeUndefined();
  });

  it("gives the way out of a zone not known on the expression typed, with a place for the zone", () => {
    expect(withZonePlaceholder("0 3 * * *")).toBe("CRON_TZ=<zone> 0 3 * * *");
    expect(withZonePlaceholder("TZ=Local 0 3 * * *")).toBe("CRON_TZ=<zone> 0 3 * * *");
    expect(withZonePlaceholder("CRON_TZ=Local @daily")).toBe("CRON_TZ=<zone> @daily");
  });
});

describe("what the review of a schedule of the form says", () => {
  it("says that no backup is made at the creation, the zone the expression names, and the next five runs with their dates", () => {
    const words = said(scheduleCreateMeaning(body(), { now: NOW }));

    expect(words["no-backup"]).toBe(
      "Velero submits no backup when the schedule is created: the first one is at the first instant of the expression after the creation, within the minute after it, since Velero looks at each schedule once a minute.",
    );
    expect(words.zone).toBe(
      "The runs are in the zone Europe/Rome, which the expression names. The server of the official image of the release knows the zones by their names; a server built otherwise must know this one, which the extension does not read.",
    );
    expect(words.runs).toBe(
      "The next 5 runs, counted from now, the creation a moment later: 2026-11-09 03:00 Europe/Rome (UTC+01:00); 2026-11-10 03:00 Europe/Rome (UTC+01:00); 2026-11-11 03:00 Europe/Rome (UTC+01:00); 2026-11-12 03:00 Europe/Rome (UTC+01:00); 2026-11-13 03:00 Europe/Rome (UTC+01:00).",
    );
  });

  it("says the offset of each run, so that a change of daylight saving time shows, and the run of an hour the zone repeats twice", () => {
    const runs = (expression: string, now: number) =>
      said(scheduleCreateMeaning(body({ expression }, { storageLocation: "default" }, now), { now })).runs;
    const repeated =
      "On 2026-10-25 the clock of Europe/Rome goes back from 03:00 to 02:00: the run of the expression in the hour it repeats is expected twice";

    // The clock of Rome goes back on 25 October 2026, and forward on 29 March 2026.
    expect(runs("CRON_TZ=Europe/Rome 30 2 * * *", Date.UTC(2026, 9, 23, 12))).toBe(
      `The next 5 runs, counted from now, the creation a moment later: 2026-10-24 02:30 Europe/Rome (UTC+02:00); 2026-10-25 02:30 Europe/Rome (UTC+02:00); 2026-10-25 02:30 Europe/Rome (UTC+01:00); 2026-10-26 02:30 Europe/Rome (UTC+01:00); 2026-10-27 02:30 Europe/Rome (UTC+01:00). ${repeated}, at 02:30 Europe/Rome (UTC+02:00) and again at 02:30 Europe/Rome (UTC+01:00).`,
    );
    expect(runs("CRON_TZ=Europe/Rome 15 * * * *", Date.UTC(2026, 9, 24, 23))).toBe(
      `The next 5 runs, counted from now, the creation a moment later: 2026-10-25 01:15 Europe/Rome (UTC+02:00); 2026-10-25 02:15 Europe/Rome (UTC+02:00); 2026-10-25 02:15 Europe/Rome (UTC+01:00); 2026-10-25 03:15 Europe/Rome (UTC+01:00); 2026-10-25 04:15 Europe/Rome (UTC+01:00). ${repeated}, at 02:15 Europe/Rome (UTC+02:00) and again at 02:15 Europe/Rome (UTC+01:00).`,
    );
    expect(runs("CRON_TZ=Europe/Rome 30 2 * * *", Date.UTC(2026, 2, 27, 12))).toBe(
      "The next 5 runs, counted from now, the creation a moment later: 2026-03-28 02:30 Europe/Rome (UTC+01:00); 2026-03-29 03:30 Europe/Rome (UTC+02:00); 2026-03-30 02:30 Europe/Rome (UTC+02:00); 2026-03-31 02:30 Europe/Rome (UTC+02:00); 2026-04-01 02:30 Europe/Rome (UTC+02:00).",
    );
    expect(runs("CRON_TZ=America/New_York 0 4 * * 1", Date.UTC(2026, 9, 23, 12))).toBe(
      "The next 5 runs, counted from now, the creation a moment later: 2026-10-26 04:00 America/New_York (UTC-04:00); 2026-11-02 04:00 America/New_York (UTC-05:00); 2026-11-09 04:00 America/New_York (UTC-05:00); 2026-11-16 04:00 America/New_York (UTC-05:00); 2026-11-23 04:00 America/New_York (UTC-05:00).",
    );
  });

  it("says the runs in the offset derived in the installation, with where it was read, when the expression names no zone", () => {
    const words = said(scheduleCreateMeaning(body({ expression: "0 3 * * *" }), { now: NOW, offset: OFFSET }));

    expect(words.zone).toBe(
      "The expression names no zone: the runs are in UTC+01:00, the offset of the clock of the Velero server when it submitted the backup daily-20261107030000 of the schedule daily, at 2026-11-07 03:00:00 UTC+01:00. The offset is derived, and across a change of daylight saving time a run may be an hour off.",
    );
    expect(words.runs).toMatch(
      /^The next 5 runs, counted from now, the creation a moment later: 2026-11-09 03:00 UTC\+01:00;/,
    );
  });

  it("says the zone Local an expression names, and what makes the offset derived less sure, as the view of a schedule does", () => {
    const offset: ServerOffset = {
      ...OFFSET,
      shared: "daily-20261107030010",
      changed: {
        minutes: 120,
        schedule: "weekly",
        backup: "weekly-20261025040000",
        submission: Date.UTC(2026, 9, 25, 2, 0, 0),
      },
    };

    expect(said(scheduleCreateMeaning(body({ expression: "TZ=Local 0 3 * * *" }), { now: NOW, offset })).zone).toBe(
      "The expression names the zone Local, the one of the Velero server: the runs are in UTC+01:00, the offset of the clock of the Velero server when it submitted the backup daily-20261107030000 of the schedule daily, at 2026-11-07 03:00:00 UTC+01:00. The offset is derived, and across a change of daylight saving time a run may be an hour off. The backup daily-20261107030010 of the same schedule was created within the same minute as daily-20261107030000, as a backup asked by hand then is: the command line names one with the time in UTC, so the offset may have been read in the name of the wrong one. The offset was UTC+02:00 when the server submitted the backup weekly-20261025040000 of the schedule weekly, at 2026-10-25 04:00:00 UTC+02:00: it changed between the two submissions, and the newest stands.",
    );
  });

  it("says why the runs are not known, and the way out, when the expression names no zone and none is derived", () => {
    const words = said(scheduleCreateMeaning(body({ expression: "0 3 * * *" }), { now: NOW }));

    expect(words.zone).toBe(
      "The next runs are not known: the expression names no zone, and the zone of the Velero server is not known, since no backup among the ones that exist gives it. Naming the zone in the expression gives them: CRON_TZ=<zone> 0 3 * * *.",
    );
    expect(words.runs).toBeUndefined();
  });

  it("says an interval from the creation, a schedule paused with no run to come, and a zone this machine does not know", () => {
    expect(said(scheduleCreateMeaning(body({ expression: "@every 6h" }), { now: NOW })).runs).toBe(
      "The first run is at its interval, 6h0m0s, after the creation, about 2026-11-08 18:00 UTC counted from now; then each one is at its interval after the submission before it, which comes up to a minute after its instant.",
    );
    const zoned = said(scheduleCreateMeaning(body({ expression: "CRON_TZ=Europe/Rome @every 6h" }), { now: NOW }));

    expect(zoned.zone).toBe(
      "An interval is counted without a zone: the zone Europe/Rome the expression names is still one the server loads when it reads the expression, or it refuses the expression.",
    );
    expect(zoned.runs).toMatch(
      /^The first run is at its interval, 6h0m0s, after the creation, about 2026-11-08 18:00 UTC/,
    );
    expect(said(scheduleCreateMeaning(body({ paused: true }), { now: NOW })).runs).toBe(
      "No run is upcoming while the schedule is paused. Once it is resumed, a run is due at once when an instant of the expression has passed since the creation, unless skip immediately is true then.",
    );
    expect(
      said(scheduleCreateMeaning(body({ expression: "CRON_TZ=Mars/Olympus_Mons 0 3 * * *" }), { now: NOW })).runs,
    ).toBe(
      "The next runs are not known here: this machine does not know the zone Mars/Olympus_Mons. The server of the official image of the release refuses a zone it cannot load: the schedule would be FailedValidation, and submit no backup, unless the server knows this one.",
    );
  });

  it("says what each flag does, as written, whole", () => {
    const off = said(scheduleCreateMeaning(body(), { now: NOW }));

    expect(off["flag-paused"]).toBe(
      `${FLAG_LABELS.paused}: false. Velero reads the schedule when it is created, and validates its expression.`,
    );
    expect(off["flag-skipImmediately"]).toBe(
      "Skip immediately: false, written so that the setting of the server, which the extension does not read, does not decide it.",
    );
    expect(off["flag-useOwnerReferencesInBackup"]).toBe(
      "Backups owned by the schedule: false. Deleting the Schedule leaves its backups as they are.",
    );
    const on = said(
      scheduleCreateMeaning(body({ skipImmediately: true, useOwnerReferencesInBackup: true }), { now: NOW }),
    );

    expect(on["flag-skipImmediately"]).toBe(
      "Skip immediately: true. At its first reading Velero sets it back to false and writes the time of that reading as the last skipped, from which the next run is counted: the count moves from the creation to that reading, and an instant of the expression between the two is skipped. It acts once.",
    );
    expect(on["flag-useOwnerReferencesInBackup"]).toBe(
      "Backups owned by the schedule: true. Every backup the schedule creates names it as its controlling owner, so that deleting the Schedule makes Kubernetes delete those Backup objects, unless it is deleted with the orphan propagation of Kubernetes. This deletes no data a finished backup holds in the storage: Velero deletes the data of a backup only through a DeleteBackupRequest. While the storage location is Available, its sync brings the finished backups back into the cluster at its next pass, without the reference to the schedule, and they expire by their time to live; the ones that waited for plugins or were finalizing come back only once they expired, as PartiallyFailed. A location whose sync period is zero does not bring them back: their data stays in the storage with no Backup object, which no expiration removes. A backup in progress loses its object, and its pod volume backups and data uploads, which it owns, are deleted with it and cancelled. The server goes on with it and writes it to the storage, but writes no phase after that: the backup stays there as finalizing, which the sync brings into the cluster only once its time to live has passed, as PartiallyFailed, and the collector of expired backups then deletes it with its data.",
    );
    const paused = said(scheduleCreateMeaning(body({ paused: true, skipImmediately: true }), { now: NOW }));

    expect(paused["flag-paused"]).toBe(
      "Paused: true. Velero does not read a paused schedule: it gets no phase and no validation of its expression, and no backup is submitted, until it is resumed. The run then counts from the creation, so that a schedule resumed after an instant of its expression submits a backup at once, unless skip immediately is true at that moment. Resuming is a change of the schedule of its own, which this form does not make.",
    );
    expect(paused["flag-skipImmediately"]).toBe(
      "Skip immediately: true. Nothing happens while the schedule is paused: when it is resumed, Velero sets it back to false at its first reading and counts the next run from that reading, so that the run that is due then is skipped. It acts once.",
    );
  });

  it("says where each backup goes, that Velero checks the template on each backup, every field, and the warnings", () => {
    const parts = scheduleCreateMeaning(
      body({}, { storageLocation: "default", includedNamespaces: ["shop", "web-*"], includeClusterResources: false }),
      {
        now: NOW,
        accessMode: "Read and write",
        listed: ["shop"],
        snapshotLocations: [
          { name: "aws-east", provider: "aws" },
          { name: "aws-west", provider: "aws" },
        ],
      },
    );
    const words = said(parts);

    expect(words.location).toBe(
      "Each backup goes to the storage location default, whose access mode is Read and write.",
    );
    expect(words.ttl).toBe(
      "Each backup is kept for the time to live the server sets, 720 hours unless it is started with another, from when Velero starts it.",
    );
    expect(words["template-checked"]).toBe(SCHEDULE_CREATE_VIEW_WORDS.templateChecked);
    expect(words["field-includeClusterResources"]).toBe(
      "Cluster-scoped resources: false. Left out, the ones an action adds included.",
    );
    expect(words["provider-aws"]).toMatch(/and refuses each backup without one\.$/);
    expect(words["not-listed"]).toBe(
      "web-*: not among the namespaces the host lists. Velero matches each as a pattern, or by its name, when each backup starts.",
    );
    expect(words["global-policy"]).toBe(
      "The resource filters and the cluster-scoped choice make each backup of the schedule FailedValidation when the server names a global volume policy with filters, a setting the extension does not read.",
    );
    expect(words["labelled-later"]).toBe(
      "A namespace that is labelled velero.io/exclude-from-backup=true after the review is excluded by Velero when it starts each backup: one the template includes makes that backup FailedValidation.",
    );
    expect(said(scheduleCreateMeaning(body({}, { storageLocation: "default", ttl: "72h" }), { now: NOW })).ttl).toBe(
      "Each backup is kept for 72h0m0s, from when Velero starts it.",
    );
    expect(parts.map((part) => part.id).slice(0, 7)).toEqual([
      "no-backup",
      "zone",
      "runs",
      "flag-paused",
      "flag-skipImmediately",
      "flag-useOwnerReferencesInBackup",
      "location",
    ]);
  });
});

describe("what the result of a schedule of the form says", () => {
  it("says the phase Velero wrote, none yet, or a schedule paused that Velero does not read", () => {
    expect(scheduleResultWords({ phase: "Enabled" })).toBe(
      "Velero wrote its phase: Enabled. It took the expression, and submits a backup at its first look after an instant, while no backup of the schedule is New, InProgress or without a phase; the instants missed meanwhile give one backup, not one each.",
    );
    expect(scheduleResultWords({ phase: "FailedValidation" })).toMatch(
      /It refused the expression, and submits no backup/,
    );
    expect(scheduleResultWords({})).toMatch(/^Velero has not read it yet/);
    expect(scheduleResultWords({ paused: true })).toBe(
      "It is paused: Velero does not read it, and writes no phase and no validation, until it is resumed.",
    );
  });
});
