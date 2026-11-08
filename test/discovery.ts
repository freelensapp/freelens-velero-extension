import { FAMILIES, RESOURCES, versionOf } from "../src/common/discovery";

// The resources the discovery of the first version of the group lists: the kinds of Velero it serves, and not the two
// of the data movement, which the second version serves.
export const FIRST_VERSION_RESOURCES: readonly string[] = FAMILIES.filter((family) => versionOf(family) === "v1").map(
  (family) => RESOURCES[family],
);
