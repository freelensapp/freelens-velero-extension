import { describe, expect, it } from "vitest";
import {
  installedVersion,
  OPERATION_KINDS,
  operationListsOf,
  realScheduleSubmission,
  writesOf,
} from "../integration/helpers/velero-guard";

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

  it("counts every write of a repository as a write while the server sends none at its pass, and leaves out the one verb it sends when it does", () => {
    const always = {
      "POST backups namespace": 1,
      "DELETE schedules resource": 1,
      "POST downloadrequests namespace": 1,
      "PATCH schedules namespace": 1,
      "PATCH schedules resource": 2,
    };
    const repositories = {
      ...counts,
      "PATCH backuprepositories resource": 4,
      "PUT backuprepositories resource": 1,
      "POST backuprepositories namespace": 1,
      "LIST backuprepositories namespace": 2,
      "WATCH backuprepositories namespace": 1,
    };
    const written = {
      "PATCH backuprepositories resource": 4,
      "PUT backuprepositories resource": 1,
      "POST backuprepositories namespace": 1,
    };

    // The server sends nothing to the real repository at its pass: every write of a repository is a write.
    expect(writesOf(repositories, false, 15)).toEqual({ ...always, ...written });
    expect(writesOf(repositories, false, 15, undefined)).toEqual({ ...always, ...written });
    // It sends a PATCH: the PATCH of the repositories is left out at every scope, as the one of the locations is,
    // and every other verb of the repositories is a write.
    expect(writesOf(repositories, false, 15, "PATCH")).toEqual({
      ...always,
      "PUT backuprepositories resource": 1,
      "POST backuprepositories namespace": 1,
    });
    expect(writesOf(repositories, false, 15, "PUT")).toEqual({
      ...always,
      "PATCH backuprepositories resource": 4,
      "POST backuprepositories namespace": 1,
    });
    // The verb of the repositories leaves out nothing of another kind.
    expect(writesOf({ "PATCH podvolumebackups resource": 1 }, false, 0, "PATCH")).toEqual({
      "PATCH podvolumebackups resource": 1,
    });
  });

  it("holds the version and the status of a repository of the installation, or its status alone while the server writes it at each pass, beside the schedule", () => {
    const status = { phase: "Ready", lastMaintenanceTime: "2026-10-29T20:00:00Z" };
    const item = { metadata: { resourceVersion: "41" }, status };

    expect(installedVersion("backuprepositories", item)).toBe(`41 ${JSON.stringify(status)}`);
    expect(installedVersion("backuprepositories", item, "PATCH")).toBe(JSON.stringify(status));
    expect(installedVersion("backuprepositories", { metadata: { resourceVersion: "42" } }, "PATCH")).toBe("{}");
    // The schedule the controller validated keeps its version whatever the server sends to a repository.
    expect(installedVersion("schedules", item)).toBe(`41 ${JSON.stringify(status)}`);
    expect(installedVersion("schedules", item, "PATCH")).toBe(`41 ${JSON.stringify(status)}`);
    // The other kinds of the installation are compared by their identities alone.
    for (const kind of ["backups", "restores", "backupstoragelocations", "podvolumebackups", "podvolumerestores"]) {
      expect([kind, installedVersion(kind, item)]).toEqual([kind, undefined]);
      expect([kind, installedVersion(kind, item, "PATCH")]).toEqual([kind, undefined]);
    }
  });

  it("names the lists of the operations a view asked: every one while no controller lists them, the ones above a window with no view open when one does", () => {
    const during = {
      "LIST podvolumebackups namespace": 3,
      "LIST podvolumerestores namespace": 1,
      "LIST datauploads namespace": 2,
      "WATCH podvolumebackups namespace": 2,
      "LIST backups namespace": 5,
      "LIST datadownloads cluster": 1,
    };
    const without = { "LIST podvolumebackups namespace": 3, "LIST datauploads namespace": 1 };

    expect(OPERATION_KINDS).toEqual(["podvolumebackups", "podvolumerestores", "datauploads", "datadownloads"]);
    // No controller lists them: every list of a namespace is of the view, and a window with none is not asked.
    expect(operationListsOf(during, false)).toEqual({ podvolumebackups: 3, podvolumerestores: 1, datauploads: 2 });
    expect(operationListsOf(during, false, without)).toEqual({
      podvolumebackups: 3,
      podvolumerestores: 1,
      datauploads: 2,
    });
    expect(operationListsOf({ "LIST backups namespace": 2 }, false)).toEqual({});
    // One does: what the window with the view open counted above the one with none.
    expect(operationListsOf(during, true, without)).toEqual({ podvolumerestores: 1, datauploads: 1 });
    expect(operationListsOf(without, true, during)).toEqual({});
    expect(() => operationListsOf(during, true)).toThrow(/window of the same length with no view open/);
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
