import { RESOURCES, validNamespace, versionOf } from "./discovery";

import type { Family } from "./discovery";

export const VELERO_API_VERSION = "velero.io/v1";

// The second version of the group, which serves the data uploads and the data downloads of the reviewed release.
export const VELERO_DATA_MOVEMENT_VERSION = "velero.io/v2alpha1";

// What the views ask of the API: the discovery of the two versions of the group, the storage locations of the
// cluster, and the lists of one namespace, each under the version of its kind. Every one is a read.
export const PATHS = {
  discovery: `/apis/${VELERO_API_VERSION}`,
  dataMovementDiscovery: `/apis/${VELERO_DATA_MOVEMENT_VERSION}`,
  // The storage locations of the whole cluster: where the installations may be.
  locations: `/apis/${VELERO_API_VERSION}/${RESOURCES.storageLocations}`,
  family(family: Family, namespace: string): string {
    // A namespace is part of a path only after it was checked to be the name of one.
    if (!validNamespace(namespace)) throw new Error("Not the name of a namespace");
    return `/apis/velero.io/${versionOf(family)}/namespaces/${namespace}/${RESOURCES[family]}`;
  },
};
