import React from "react";
import { BACKUP_CREATE_VIEW_WORDS, locationsReadWords } from "../../common/backup-create-words";
import { accessMode, availabilityState } from "../../common/location-view";
import { hostNamespaces } from "../api/host-namespaces";

import type { BackupTemplate, TemplateField } from "../../common/backup-template";
import type { BackupStorageLocationResource, VolumeSnapshotLocationResource } from "../../common/types";
import type { Installation } from "../state/installation";
import type { LocationChoice, TemplateChoices, TemplateState } from "./backup-template-form";

// The storage locations of the installation as the form offers them: the default marked, and the reason the release
// refuses every backup sent to one that is not reported Available or whose access mode is ReadOnly (SPEC-0016,
// REQ-236). The default comes first.
export function locationChoices(locations: BackupStorageLocationResource[]): LocationChoice[] {
  return locations
    .map((location) => {
      const name = location.metadata.name;
      const refused =
        availabilityState(location.status?.phase).availability !== "available"
          ? BACKUP_CREATE_VIEW_WORDS.unavailable(name)
          : accessMode(location).mode === "ReadOnly"
            ? BACKUP_CREATE_VIEW_WORDS.readOnly(name)
            : undefined;

      return { name, isDefault: location.spec?.default === true, ...(refused ? { refused } : {}) };
    })
    .sort((one, other) => Number(other.isDefault) - Number(one.isDefault) || (one.name < other.name ? -1 : 1));
}

// What the form of a template offers and what holds its review back, as the installation and the host read them, for
// the creation of a backup and of a schedule alike: the locations, the default chosen first when it can be chosen; the
// snapshot locations with their providers, or why they are not known; the namespaces the host lists; and, at the field
// each is of, what the form says is wrong of what the cluster holds: an included namespace the host lists with the
// label that excludes it, and a storage location that cannot be chosen, none, not read, or the one chosen, refused or
// gone since. The access mode of the location chosen is said when it is written.
export function useTemplateChoices(
  installation: Installation,
  state: TemplateState & { template: BackupTemplate },
): {
  choices: TemplateChoices;
  blockers: string[];
  snapshotLocations: { name: string; provider: string }[];
  listed: string[];
  accessMode?: string;
} {
  const locationsRead = installation.read("storageLocations");
  const snapshotsRead = installation.read("snapshotLocations");
  const namespaces = hostNamespaces();
  const locations = locationChoices(locationsRead.items as BackupStorageLocationResource[]);
  const snapshotLocations = (snapshotsRead.items as VolumeSnapshotLocationResource[]).map((location) => ({
    name: location.metadata.name,
    provider: String((location.spec as { provider?: unknown } | undefined)?.provider ?? ""),
  }));
  const first = locations.find((location) => !location.refused);

  React.useEffect(() => {
    if (state.template.storageLocation === undefined && first?.isDefault) state.set("storageLocation", first.name);
  }, [state, first]);

  const chosen = state.template.storageLocation;
  const chosenLocation = locations.find((location) => location.name === chosen);
  const fieldBlockers: Partial<Record<TemplateField, string[]>> = {
    includedNamespaces: (state.template.includedNamespaces ?? [])
      .filter((included) => namespaces.some((listed) => listed.name === included && listed.excluded))
      .map(BACKUP_CREATE_VIEW_WORDS.labelledExcluded),
    storageLocation:
      locationsRead.status !== "ready"
        ? [locationsReadWords(locationsRead.status, "storage")]
        : !first
          ? [BACKUP_CREATE_VIEW_WORDS.noLocation]
          : chosen === undefined
            ? []
            : !chosenLocation
              ? [BACKUP_CREATE_VIEW_WORDS.chosenGone(chosen)]
              : chosenLocation.refused
                ? [BACKUP_CREATE_VIEW_WORDS.chosenRefused(chosenLocation.refused)]
                : [],
  };
  const location = (locationsRead.items as BackupStorageLocationResource[]).find(
    (item) => item.metadata.name === chosen,
  );
  const access = location ? accessMode(location) : undefined;

  return {
    choices: {
      locations,
      snapshotLocations,
      ...(snapshotsRead.status === "ready"
        ? {}
        : { snapshotLocationsUnknown: locationsReadWords(snapshotsRead.status, "snapshot") }),
      namespaces,
      blockers: fieldBlockers,
    },
    blockers: Object.values(fieldBlockers).flat(),
    snapshotLocations,
    listed: namespaces.map((listed) => listed.name),
    // An access mode that is not written is said as nothing: Velero refuses a backup for it only when it is ReadOnly.
    ...(access && access.mode !== "not-set" ? { accessMode: access.label } : {}),
  };
}
