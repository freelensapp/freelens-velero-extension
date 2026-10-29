import { volumeWays } from "../../common/volume-band";
import { volumeIndex } from "../../common/volume-index";

import type { OperationKind } from "../../common/phases";
import type { VolumeWays } from "../../common/volume-band";
import type { VolumeIndex } from "../../common/volume-index";
import type { Installation } from "./installation";

// What the views of one installation share of its operations of the volumes for a read (SPEC-0014, REQ-194): the
// index is made once for the reads it is made of. A tick of the clock of the views makes no new one; a read does,
// since it makes a new array of items.
const MADE = new WeakMap<Installation, { key: unknown[]; index: VolumeIndex }>();

export function volumesOf(installation: Installation): VolumeIndex {
  // The reads as they are stored: what the installation gives of a family is a new object at each call. The
  // availability of the API is in the key as well, since what a read is said to be depends on it.
  const key = [installation.reads.podVolumeBackups, installation.reads.podVolumeRestores, installation.api];
  const made = MADE.get(installation);

  if (made?.key.every((value, index) => value === key[index])) return made.index;
  const index = volumeIndex({
    podVolumeBackups: installation.read("podVolumeBackups"),
    podVolumeRestores: installation.read("podVolumeRestores"),
  });

  MADE.set(installation, { key, index });
  return index;
}

// The ways of the rows of the Volumes tab of one backup or restore, which its viewer is given. They are the same
// object for as long as they lead to the same operations, in whatever order: a read makes a new index, and a read
// that changes none of them does not draw the viewer again.
const WAYS = new WeakMap<Installation, { index: VolumeIndex; owner: string; key: string; ways: VolumeWays }>();

export function volumeWaysOf(
  installation: Installation,
  kind: OperationKind,
  owner: { namespace?: string; uid?: string },
): VolumeWays {
  const index = volumesOf(installation);
  const of = `${kind}\u0000${owner.namespace ?? ""}\u0000${owner.uid ?? ""}`;
  const made = WAYS.get(installation);

  if (made && made.index === index && made.owner === of) return made.ways;
  const ways = volumeWays(index, kind, owner);
  const key = [...ways]
    .map(([row, target]) => `${row}\u0001${target.kind}/${target.name}`)
    .sort()
    .join("\u0002");

  if (made && made.owner === of && made.key === key) {
    WAYS.set(installation, { ...made, index });
    return made.ways;
  }
  WAYS.set(installation, { index, owner: of, key, ways });
  return ways;
}
