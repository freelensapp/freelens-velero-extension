import { runInAction } from "mobx";
import { describe, expect, it } from "vitest";
import { emptyPreferences, heldPreferences } from "../src/common/discovery";
import { operationState } from "../src/common/phases";
import { backupBand } from "../src/common/volume-band";
import { Installation } from "../src/renderer/state/installation";
import { volumesOf } from "../src/renderer/state/volumes";
import { backup, before, MINUTE, NOW, ownedBy, podVolumeBackup, read, restore } from "./volume-builders";

import type { Resource } from "../src/renderer/state/installation";

// The measure of the unit tests of the index of the operations of the volumes (KIND-18, REQ-194): the 1,000
// backups, the 1,000 restores and the 2,000 pod volume backups of an installation of the long lists, the index made
// for a read of them, and the band of a backup of 200 operations found in it. Each is made twenty times after five
// calls that warm it, within the budget of an interaction at the 95th percentile. A tick of the clock makes no new
// index, which the measure asserts beside the times. The 200 data uploads of the requirement join it with the data
// movement. No other test times them: this file is run by its own configuration, once the other tests ended and
// alone, as the measure of the log is.
const BUDGET = 250;
const BACKUPS = 1000;
const RESTORES = 1000;
const OPERATIONS = 2000;
// The backup whose band is measured holds 200 of the operations; the others are of the other backups, one each.
const OF_ONE = 200;
const WARM = 5;
const MEASURED = 20;

const backups = Array.from({ length: BACKUPS }, (_, index) =>
  backup(`backup-${index}`, index === 0 ? "InProgress" : "Completed", { uid: `backup-uid-${index}` }),
);
const restores = Array.from({ length: RESTORES }, (_, index) =>
  restore(`restore-${index}`, "Completed", { uid: `restore-uid-${index}` }),
);
const PHASES = ["Completed", "Failed", "InProgress", "Accepted", "New", "Canceled", "Prepared", "Canceling"];
const operations = Array.from({ length: OPERATIONS }, (_, index) => {
  const owner = index < OF_ONE ? backups[0] : backups[1 + ((index - OF_ONE) % (BACKUPS - 1))];

  return podVolumeBackup(
    `operation-${index}`,
    { phase: PHASES[index % PHASES.length], startTimestamp: before((index + 1) * MINUTE) },
    {
      ...ownedBy("Backup", owner),
      spec: { pod: { kind: "Pod", namespace: `ns-${index % 40}`, name: `pod-${index}`, uid: `pod-uid-${index}` } },
    },
  );
});

// The percentile of the measures of the packaged application: of twenty times, the 95th leaves the slowest out, and
// no other.
function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((one, other) => one - other);

  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function timed<Value>(call: () => Value): { ms: number; value: Value } {
  const start = performance.now();
  const value = call();

  return { ms: performance.now() - start, value };
}

const hundredths = (ms: number) => Math.round(ms * 100) / 100;

function series(times: number[]) {
  return {
    p95: hundredths(percentile(times, 0.95)),
    median: hundredths(percentile(times, 0.5)),
    slowest: hundredths(Math.max(...times)),
    times: times.map(hundredths),
  };
}

// A read of the installation: each family is stored as a new read, with a new array of the same objects, as a read
// that changed nothing leaves it.
function readAgain(installation: Installation): void {
  runInAction(() => {
    installation.reads = {
      ...installation.reads,
      backups: read([...backups] as unknown as Resource[], "ready", NOW),
      restores: read([...restores] as unknown as Resource[], "ready", NOW),
      podVolumeBackups: read([...operations] as unknown as Resource[], "ready", NOW),
      podVolumeRestores: read([] as Resource[], "ready", NOW),
    };
  });
}

describe("the index of the operations of an installation of the long lists", { timeout: 120_000 }, () => {
  it("is made for a read, and the band of a backup of 200 operations found in it, within the budget", () => {
    const installation = new Installation({
      cluster: { id: "cluster-a", name: "local-demo" },
      read: async () => ({ status: 404 }),
      now: () => NOW,
      storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": "velero" } }),
    });
    const state = operationState("Backup", "InProgress");
    const made = () => {
      readAgain(installation);
      return timed(() => volumesOf(installation));
    };
    const warm = Array.from({ length: WARM }, () => made().ms);
    const measured = Array.from({ length: MEASURED }, () => made());
    const index = volumesOf(installation);
    const bandWarm = Array.from({ length: WARM }, () => timed(() => backupBand(index, backups[0], state)).ms);
    const bands = Array.from({ length: MEASURED }, () => timed(() => backupBand(index, backups[0], state)));
    // A tick of the clock of the views, with no read: the index is the one of the read.
    const tick = timed(() => volumesOf(installation));
    const band = bands[0].value;
    const report = {
      backups: BACKUPS,
      restores: RESTORES,
      podVolumeBackups: OPERATIONS,
      ofTheBackup: band.operations.length,
      budget: BUDGET,
      index: { ...series(measured.map((call) => call.ms)), warm: warm.map(hundredths) },
      band: { ...series(bands.map((call) => call.ms)), warm: bandWarm.map(hundredths) },
      tick: hundredths(tick.ms),
    };

    // Written before anything is asserted, so that a run that fails leaves its numbers.
    console.log(`KIND-18 unit ${JSON.stringify(report)}`);
    // A read made a new index each time, and a tick none.
    expect(new Set(measured.map((call) => call.value)).size).toBe(MEASURED);
    expect(tick.value).toBe(index);
    expect(volumesOf(installation)).toBe(index);
    // The band holds the 200 of the backup, from the newest, each counted once in its group.
    expect(band.operations).toHaveLength(OF_ONE);
    expect(band.operations[0].metadata.name).toBe("operation-0");
    expect(band.groups.reduce((sum, group) => sum + group.count, 0)).toBe(OF_ONE);
    expect(bands.every((call) => call.value.operations === band.operations)).toBe(true);
    // Every other backup holds its own, found in one look of the index.
    expect(index.ofBackup.size).toBe(BACKUPS);
    // Both series answer within their budget at the 95th percentile.
    expect(measured.every((call) => call.ms > 0)).toBe(true);
    expect(report.index.p95).toBeLessThan(BUDGET);
    expect(report.band.p95).toBeLessThan(BUDGET);
  });
});
