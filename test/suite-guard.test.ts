import { describe, expect, it } from "vitest";
import { realScheduleSubmission, writesOf } from "../integration/helpers/velero-guard";

describe("the guard of the suites", () => {
  // What the API server counted, by verb, kind and scope, as the helpers read it from its counters.
  const counts = {
    "LIST backups namespace": 4,
    "GET schedules resource": 2,
    "WATCH schedules namespace": 1,
    "POST backups namespace": 1,
    "PATCH backupstoragelocations resource": 3,
    "PATCH schedules resource": 2,
    "PATCH schedules namespace": 1,
    "DELETE schedules resource": 1,
    "POST downloadrequests namespace": 1,
  };

  it("counts every request that is not a read as a write, but the PATCH of a storage location, and the PATCH of a schedule by name only above the whole minutes of the window and two while its controller sends one at every look", () => {
    const always = {
      "POST backups namespace": 1,
      "DELETE schedules resource": 1,
      "POST downloadrequests namespace": 1,
      "PATCH schedules namespace": 1,
    };

    // Its controller sends no PATCH at every look: every PATCH of a schedule is a write, whatever the window.
    expect(writesOf(counts, false, 0)).toEqual({ ...always, "PATCH schedules resource": 2 });
    expect(writesOf(counts, false, 90)).toEqual({ ...always, "PATCH schedules resource": 2 });
    // It does: no more than the whole minutes of the window and two are left out, and only by name.
    expect(writesOf(counts, true, 0)).toEqual(always);
    expect(writesOf({ ...counts, "PATCH schedules resource": 3 }, true, 0.99)).toEqual({
      ...always,
      "PATCH schedules resource": 1,
    });
    expect(writesOf({ ...counts, "PATCH schedules resource": 5 }, true, 3.9)).toEqual(always);
    expect(writesOf({ ...counts, "PATCH schedules resource": 9 }, true, 3.9)).toEqual({
      ...always,
      "PATCH schedules resource": 4,
    });
    expect(writesOf({ "PATCH schedules resource": 37 }, true, 35.6)).toEqual({});
    expect(writesOf({ "PATCH schedules resource": 38 }, true, 35.6)).toEqual({ "PATCH schedules resource": 1 });
    expect(writesOf({}, true, 0)).toEqual({});
    // A window that is not one is refused, not taken as none.
    for (const minutes of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => writesOf(counts, true, minutes)).toThrow(/window of minutes/);
    }
  });

  it("says that the schedule the controller validated submitted a backup, by its last submission and by each backup that carries its label, and says nothing of one that submitted none", () => {
    const name = "fixture-yearly-a1b2c3d4";
    const schedule = (status?: { lastBackup?: string } | null) => ({
      kind: "Schedule",
      metadata: { name, labels: {} },
      ...(status === undefined ? {} : { status }),
    });
    const backup = (backupName: string, of: string) => ({
      kind: "Backup",
      metadata: { name: backupName, labels: { "velero.io/schedule-name": of } },
    });
    const way = "No suite expects one. Create the environment again with `pnpm demo:down` and `pnpm demo:up`.";

    // Validated, with no submission; the backups of the installation that are of another schedule or of none.
    expect(
      realScheduleSubmission(name, [
        schedule({}),
        backup("fixture-backup-a1b2c3d4", ""),
        backup("other-20261026100000", "other"),
        { kind: "Schedule", metadata: { name: "other" }, status: { lastBackup: "2026-10-26T10:00:00Z" } },
      ]),
    ).toBeUndefined();
    expect(realScheduleSubmission(name, [schedule(null)])).toBeUndefined();
    expect(realScheduleSubmission(name, [schedule()])).toBeUndefined();
    // A last submission, a backup with its label, or both.
    expect(realScheduleSubmission(name, [schedule({ lastBackup: "2026-10-26T10:00:00Z" })])).toBe(
      `The schedule ${name} submitted a backup since its placement found it with none: its last submission is ` +
        `2026-10-26T10:00:00Z. ${way}`,
    );
    expect(realScheduleSubmission(name, [schedule({}), backup(`${name}-20261026100000`, name)])).toBe(
      `The schedule ${name} submitted a backup since its placement found it with none: the backup ` +
        `${name}-20261026100000 carries its label. ${way}`,
    );
    expect(
      realScheduleSubmission(name, [
        backup(`${name}-20261026100000`, name),
        schedule({ lastBackup: "2026-10-26T10:00:00Z" }),
      ]),
    ).toBe(
      `The schedule ${name} submitted a backup since its placement found it with none: its last submission is ` +
        `2026-10-26T10:00:00Z, the backup ${name}-20261026100000 carries its label. ${way}`,
    );
    // A backup with the label of a schedule that is gone is still a submission of it.
    expect(realScheduleSubmission(name, [backup(`${name}-20261026100000`, name)])).toMatch(/carries its label/);
  });
});
