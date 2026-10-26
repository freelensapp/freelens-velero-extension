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

  it("counts every request that is not a read as a write, but the PATCH of a storage location, and the PATCH of a schedule only while its controller does not send one at every look", () => {
    const always = {
      "POST backups namespace": 1,
      "DELETE schedules resource": 1,
      "POST downloadrequests namespace": 1,
    };

    expect(writesOf(counts, false)).toEqual({
      ...always,
      "PATCH schedules resource": 2,
      "PATCH schedules namespace": 1,
    });
    expect(writesOf(counts, true)).toEqual(always);
    expect(writesOf({}, true)).toEqual({});
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
