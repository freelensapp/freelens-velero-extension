import { RESOURCES, validNamespace } from "./discovery";

import type { Family } from "./discovery";

export const VELERO_API_VERSION = "velero.io/v1";

// What the views ask of the API: the discovery of the group, the storage locations of the cluster, and the
// lists of one namespace. Every one is a read.
export const PATHS = {
  discovery: `/apis/${VELERO_API_VERSION}`,
  // The storage locations of the whole cluster: where the installations may be.
  locations: `/apis/${VELERO_API_VERSION}/${RESOURCES.storageLocations}`,
  family(family: Family, namespace: string): string {
    // A namespace is part of a path only after it was checked to be the name of one.
    if (!validNamespace(namespace)) throw new Error("Not the name of a namespace");
    return `/apis/${VELERO_API_VERSION}/namespaces/${namespace}/${RESOURCES[family]}`;
  },
};
