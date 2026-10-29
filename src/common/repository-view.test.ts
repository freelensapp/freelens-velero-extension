import { describe, expect, it } from "vitest";
import { before, DAY, HOUR, MINUTE, NOW, repository } from "../../test/volume-builders";
import {
  dueText,
  maintenanceDue,
  REPOSITORY_SORTING,
  repositoryFrequencyText,
  repositorySearch,
  repositoryView,
} from "./repository-view";
import { REPOSITORY_WORDS } from "./volume-words";

describe("the view of a backup repository", () => {
  it("reads what it is of, its readiness and its maintenances", () => {
    const view = repositoryView(
      repository(
        "shop-default-restic",
        {
          phase: "NotReady",
          message: 'error to connect "s3:https://reader:secret@s3.example.test/store/restic/shop?token=abc": refused',
          lastMaintenanceTime: before(2 * DAY),
          recentMaintenance: [
            { result: "Succeeded", startTimestamp: before(2 * DAY + 5 * MINUTE), completeTimestamp: before(2 * DAY) },
            {
              result: "Failed",
              startTimestamp: before(HOUR),
              completeTimestamp: before(HOUR - MINUTE),
              message: "out of space",
            },
            { result: "Succeeded", startTimestamp: before(9 * DAY + MINUTE), completeTimestamp: before(9 * DAY) },
          ],
        },
        {
          spec: {
            repositoryType: "restic",
            resticIdentifier: "s3:https://reader:secret@s3.example.test/store/restic/shop?token=abc",
            maintenanceFrequency: "168h0m0s",
            repositoryConfig: { cacheLimitMB: "2048", enableCompression: "true" },
          },
        },
      ),
    );

    expect(view).toEqual({
      name: "shop-default-restic",
      namespace: "velero",
      uid: "backuprepository-shop-default-restic",
      volumeNamespace: "shop",
      location: "default",
      type: "restic",
      resticIdentifier: { value: "s3:https://s3.example.test/store/restic/shop", shortened: true },
      frequency: { read: true, milliseconds: 168 * HOUR, written: "168h0m0s" },
      config: [
        { key: "cacheLimitMB", value: "2048" },
        { key: "enableCompression", value: "true" },
      ],
      readiness: { reported: "NotReady", readiness: "not-ready", label: "Not ready" },
      message: { value: 'error to connect "s3:https://s3.example.test/store/restic/shop": refused', shortened: true },
      lastMaintenance: NOW - 2 * DAY,
      // Newest first by their start, whatever their order in the object, each with its duration.
      maintenances: [
        {
          result: { reported: "Failed", result: "failed", label: "Failed" },
          started: NOW - HOUR,
          completed: NOW - HOUR + MINUTE,
          milliseconds: MINUTE,
          message: { value: "out of space", shortened: false },
        },
        {
          result: { reported: "Succeeded", result: "succeeded", label: "Succeeded" },
          started: NOW - 2 * DAY - 5 * MINUTE,
          completed: NOW - 2 * DAY,
          milliseconds: 5 * MINUTE,
        },
        {
          result: { reported: "Succeeded", result: "succeeded", label: "Succeeded" },
          started: NOW - 9 * DAY - MINUTE,
          completed: NOW - 9 * DAY,
          milliseconds: MINUTE,
        },
      ],
      newestFailed: true,
      created: NOW - DAY,
    });
  });

  it("is never maintained, with no recent maintenance, when the object carries no time", () => {
    const view = repositoryView(repository("shop-default-kopia", { phase: "Ready" }));

    expect([view.lastMaintenance, view.maintenances, view.newestFailed]).toEqual([undefined, [], false]);
    expect(REPOSITORY_WORDS.neverMaintained).toBe("Never maintained");
  });

  it("puts a maintenance with no start after the ones that have one, and gives none a duration it cannot have", () => {
    const view = repositoryView(
      repository("r", {
        phase: "Ready",
        recentMaintenance: [
          { result: "Failed", message: "the Job could not start" },
          { result: "Succeeded", startTimestamp: before(HOUR), completeTimestamp: before(2 * HOUR) },
        ],
      }),
    );

    expect(view.maintenances.map((one) => [one.result.result, one.milliseconds])).toEqual([
      ["succeeded", undefined],
      ["failed", undefined],
    ]);
    expect(view.newestFailed).toBe(false);
  });
});

describe("when the next maintenance is due, by the clock of this machine", () => {
  const due = (status: object, spec: object = {}, readOnly = false, now = NOW) =>
    maintenanceDue(repositoryView(repository("r", status as never, { spec })), now, readOnly);

  it("is due when the last one is older than the frequency, and when a ready repository has none", () => {
    expect(due({ phase: "Ready", lastMaintenanceTime: before(8 * DAY) })).toEqual({ state: "due", late: DAY });
    expect(due({ phase: "Ready" })).toEqual({ state: "due-no-time" });
    expect(dueText({ state: "due", late: DAY })).toBe(
      "Due: the last maintenance is older than the frequency, by 1d, by the clock of this machine.",
    );
    expect(dueText({ state: "due-no-time" })).toBe(REPOSITORY_WORDS.dueNoTime);
  });

  it("is when the frequency ends after the last one, and moves with the clock", () => {
    expect(due({ phase: "Ready", lastMaintenanceTime: before(DAY) })).toEqual({
      state: "not-due",
      at: NOW + 6 * DAY,
      left: 6 * DAY,
    });
    expect(due({ phase: "Ready", lastMaintenanceTime: before(DAY) }, {}, false, NOW + 6 * DAY)).toEqual({
      state: "due",
      late: 0,
    });
    expect(dueText({ state: "not-due", at: 0, left: 6 * DAY + 2 * HOUR })).toBe(
      "Due in 6d 2h, by the clock of this machine.",
    );
  });

  it("is not computed with a frequency that is not set, which the server fills, or that cannot be read", () => {
    expect(due({ phase: "Ready" }, { maintenanceFrequency: "" })).toEqual({ state: "frequency-not-set" });
    expect(due({ phase: "Ready" }, { maintenanceFrequency: "weekly" })).toEqual({
      state: "frequency-unreadable",
      written: "weekly",
    });
    expect(dueText({ state: "frequency-not-set" })).toBe(REPOSITORY_WORDS.frequencyNotSet);
    expect(dueText({ state: "frequency-unreadable", written: "weekly" })).toBe(
      "The frequency weekly is not a duration: when the next maintenance is due is not computed.",
    );
    expect(
      repositoryFrequencyText(
        repositoryView(repository("r", undefined, { spec: { maintenanceFrequency: "" } })).frequency,
      ),
    ).toBe("Not set");
  });

  it("is not known when whether the location is read-only is not known", () => {
    const old = repositoryView(repository("r", { phase: "Ready", lastMaintenanceTime: before(30 * DAY) } as never));

    expect(maintenanceDue(old, NOW, undefined)).toEqual({ state: "access-unknown" });
    expect(maintenanceDue(old, NOW, false)).toMatchObject({ state: "due" });
    expect(dueText({ state: "access-unknown" })).toBe(
      "Not known: the storage location of the repository is not known, and the server runs no maintenance of a repository of a read-only one.",
    );
  });

  it("is not known yet while the storage locations were never answered, and not taken for one that is absent", () => {
    const old = repositoryView(repository("r", { phase: "Ready", lastMaintenanceTime: before(30 * DAY) } as never));

    expect(maintenanceDue(old, NOW, undefined, false)).toEqual({ state: "locations-being-read" });
    // A location that was found says what it is, answered or not; one that is not found once they answered is not
    // known.
    expect(maintenanceDue(old, NOW, false, false)).toMatchObject({ state: "due" });
    expect(maintenanceDue(old, NOW, undefined, true)).toEqual({ state: "access-unknown" });
    // What is not computed for other reasons is said first, as it is when they answered.
    expect(maintenanceDue(repositoryView(repository("r", { phase: "NotReady" })), NOW, undefined, false)).toEqual({
      state: "not-ready",
    });
    expect(dueText({ state: "locations-being-read" })).toBe(
      "Not known yet: the storage locations of the installation are being read, and the server runs no maintenance of a repository of a read-only one.",
    );
  });

  it("is none for a repository that is not ready, or of a read-only location", () => {
    expect(due({ phase: "NotReady", lastMaintenanceTime: before(30 * DAY) })).toEqual({ state: "not-ready" });
    expect(due({})).toEqual({ state: "not-ready" });
    expect(due({ phase: "Ready", lastMaintenanceTime: before(30 * DAY) }, {}, true)).toEqual({ state: "read-only" });
    expect(dueText({ state: "read-only" })).toBe(REPOSITORY_WORDS.readOnly);
  });

  it("says the pass of five minutes and the Job the extension does not read, and no verdict on the backups", () => {
    expect(REPOSITORY_WORDS.pass).toContain("every five minutes");
    expect(REPOSITORY_WORDS.job).toContain("Job of the installation, which the extension does not read");
    expect(REPOSITORY_WORDS.what).toContain("nothing of the backups it holds");
  });
});

describe("the list of the repositories", () => {
  const views = [
    repository("a-ready", { phase: "Ready", lastMaintenanceTime: before(HOUR) }),
    repository("b-new", undefined, { spec: { maintenanceFrequency: "soon", repositoryType: "" } }),
    repository("c-not-ready", { phase: "NotReady", message: "connection refused" }),
    repository("d-odd", { phase: "Broken" }, { spec: { volumeNamespace: "", backupStorageLocation: "" } }),
  ].map(repositoryView);

  it("is searched by what its columns show and by the message of Velero", () => {
    expect(repositorySearch(views[2])).toEqual([
      "c-not-ready",
      "velero",
      "shop",
      "default",
      "kopia",
      "NotReady",
      "Not ready",
      "connection refused",
      "168h0m0s",
    ]);
    expect(repositorySearch(views[1])).toContain("Not set");
    // The mark of a failed newest maintenance is searched by its words.
    const failing = repositoryView(
      repository("e-failing", {
        phase: "Ready",
        recentMaintenance: [{ result: "Failed", startTimestamp: before(DAY), completeTimestamp: before(DAY) }],
      }),
    );

    expect(failing.newestFailed).toBe(true);
    expect(repositorySearch(failing)).toContain("the newest maintenance failed");
  });

  it("is ordered by callbacks that answer a number, a text or an array, never undefined or NaN", () => {
    for (const [column, order] of Object.entries(REPOSITORY_SORTING)) {
      for (const view of views) {
        const value = [order(view)].flat();

        expect([column, value.some((part) => part === undefined || Number.isNaN(part))]).toEqual([column, false]);
      }
    }
    expect(views.map(REPOSITORY_SORTING.readiness)).toEqual([
      [0, "Ready"],
      [2, ""],
      [1, "NotReady"],
      [3, "Broken"],
    ]);
    // None last in the first order a click gives.
    expect(views.map(REPOSITORY_SORTING.maintained)).toEqual([
      [0, NOW - HOUR],
      [1, 0],
      [1, 0],
      [1, 0],
    ]);
    expect(views.map(REPOSITORY_SORTING.frequency)).toEqual([168 * HOUR, -1, 168 * HOUR, 168 * HOUR]);
  });
});
