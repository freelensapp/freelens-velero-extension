import { volumeIndex } from "../../common/volume-index";

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
