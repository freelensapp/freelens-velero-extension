import { emptyRead } from "../../common/read-state";
import { adherenceContext } from "../../common/schedule-signal";

import type { AdherenceContext } from "../../common/schedule-signal";
import type { ScheduleResource } from "../../common/types";
import type { Installation } from "./installation";

// What the views of one installation share of the adherence of its schedules for a read and a tick of their
// clock (SPEC-0013): the reads of the schedules and of the backups, the offset of the zone of the server kept
// for the installation, the time of its API server and the clocks. It is made once for them: the rows of the
// list, the band of a schedule and the details of the host ask for it at every drawing.
const MADE = new WeakMap<Installation, { key: unknown[]; context: AdherenceContext }>();

export function adherenceOf(installation: Installation, now: number): AdherenceContext {
  // The reads as they are stored: what the installation gives of a family is a new object at each call. The
  // availability of the API is in the key as well, since what a read is said to be depends on it.
  const key = [
    installation.reads.schedules,
    installation.reads.backups,
    installation.api,
    installation.serverOffset,
    installation.serverTime,
    now,
  ];
  const made = MADE.get(installation);

  if (made?.key.every((value, index) => value === key[index])) return made.context;
  const context = adherenceContext(
    { schedules: installation.read("schedules"), backups: installation.read("backups") },
    now,
    installation.serverOffset,
    installation.serverTime,
  );

  MADE.set(installation, { key, context });
  return context;
}

// What the adherence of a schedule of another namespace than the one the installation reads is computed with:
// nothing of its installation was read, its backups and the offset of its server among it, and nothing of
// another installation is taken for it.
export function unreadAdherence(now: number): AdherenceContext {
  return adherenceContext({ schedules: emptyRead<ScheduleResource>(), backups: emptyRead() }, now);
}

// Whether the backups of the installation were answered once: before that the views say nothing of the
// adherence of a schedule, as of a family that was never answered.
export function backupsAnswered(installation: Installation): boolean {
  const read = installation.read("backups");

  return read.lastSuccess !== undefined || (read.status !== "idle" && read.status !== "loading");
}
