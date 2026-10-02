import { Renderer } from "@freelensapp/extensions";
import { PreferencesStore } from "../common/preferences-store";
import { VeleroIpcRenderer } from "./api/ipc";
import { Backup, BackupStorageLocation, Restore, Schedule, VolumeSnapshotLocation } from "./api/kinds";
import { VeleroIcon } from "./components/velero-icon";
import { BackupDetails } from "./details/backup-details";
import { RestoreDetails } from "./details/restore-details";
import { ScheduleDetails } from "./details/schedule-details";
import { SnapshotLocationDetails } from "./details/snapshot-location-details";
import { StorageLocationDetails } from "./details/storage-location-details";
import {
  BACKUPS_MENU_ID,
  BACKUPS_PAGE_ID,
  OVERVIEW_MENU_ID,
  OVERVIEW_PAGE_ID,
  RESTORES_MENU_ID,
  RESTORES_PAGE_ID,
  ROOT_MENU_ID,
  SCHEDULES_MENU_ID,
  SCHEDULES_PAGE_ID,
  SNAPSHOT_LOCATIONS_MENU_ID,
  SNAPSHOT_LOCATIONS_PAGE_ID,
  STORAGE_LOCATIONS_MENU_ID,
  STORAGE_LOCATIONS_PAGE_ID,
} from "./navigation";
import { BackupsPage } from "./pages/backups-page";
import { OverviewPage } from "./pages/overview-page";
import { RestoresPage } from "./pages/restores-page";
import { SchedulesPage } from "./pages/schedules-page";
import { SnapshotLocationsPage } from "./pages/snapshot-locations-page";
import { StorageLocationsPage } from "./pages/storage-locations-page";

export default class VeleroRenderer extends Renderer.LensExtension {
  // Only the views that exist have a page and an entry: nothing here leads to a page that is not there.
  clusterPages = [
    { id: OVERVIEW_PAGE_ID, components: { Page: () => <OverviewPage extension={this} /> } },
    { id: BACKUPS_PAGE_ID, components: { Page: () => <BackupsPage /> } },
    { id: RESTORES_PAGE_ID, components: { Page: () => <RestoresPage /> } },
    { id: SCHEDULES_PAGE_ID, components: { Page: () => <SchedulesPage /> } },
    { id: STORAGE_LOCATIONS_PAGE_ID, components: { Page: () => <StorageLocationsPage /> } },
    { id: SNAPSHOT_LOCATIONS_PAGE_ID, components: { Page: () => <SnapshotLocationsPage /> } },
  ];

  // The host gives a page the tabs of its group when the first entry that leads to it is an entry of the
  // group: the entries of the pages come before the one of the group, which names the first of them.
  // With the group first, the page it names would be the only one without the tabs. The entry of a
  // group opens the group, in the host, and is marked while the page it names is shown.
  clusterPageMenus = [
    {
      id: OVERVIEW_MENU_ID,
      parentId: ROOT_MENU_ID,
      title: "Overview",
      target: { pageId: OVERVIEW_PAGE_ID },
      components: {},
    },
    {
      id: BACKUPS_MENU_ID,
      parentId: ROOT_MENU_ID,
      title: Backup.crd.title,
      target: { pageId: BACKUPS_PAGE_ID },
      components: {},
    },
    {
      id: RESTORES_MENU_ID,
      parentId: ROOT_MENU_ID,
      title: Restore.crd.title,
      target: { pageId: RESTORES_PAGE_ID },
      components: {},
    },
    {
      id: SCHEDULES_MENU_ID,
      parentId: ROOT_MENU_ID,
      title: Schedule.crd.title,
      target: { pageId: SCHEDULES_PAGE_ID },
      components: {},
    },
    {
      id: STORAGE_LOCATIONS_MENU_ID,
      parentId: ROOT_MENU_ID,
      title: BackupStorageLocation.crd.title,
      target: { pageId: STORAGE_LOCATIONS_PAGE_ID },
      components: {},
    },
    {
      id: SNAPSHOT_LOCATIONS_MENU_ID,
      parentId: ROOT_MENU_ID,
      title: VolumeSnapshotLocation.crd.title,
      target: { pageId: SNAPSHOT_LOCATIONS_PAGE_ID },
      components: {},
    },
    { id: ROOT_MENU_ID, title: "Velero", target: { pageId: OVERVIEW_PAGE_ID }, components: { Icon: VeleroIcon } },
  ];

  kubeObjectDetailItems = [
    {
      kind: Backup.kind,
      apiVersions: Backup.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<Backup>) => (
          <BackupDetails {...props} extension={this} />
        ),
      },
    },
    {
      kind: Restore.kind,
      apiVersions: Restore.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<Restore>) => (
          <RestoreDetails {...props} extension={this} />
        ),
      },
    },
    {
      kind: Schedule.kind,
      apiVersions: Schedule.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<Schedule>) => (
          <ScheduleDetails {...props} extension={this} />
        ),
      },
    },
    {
      kind: BackupStorageLocation.kind,
      apiVersions: BackupStorageLocation.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<BackupStorageLocation>) => (
          <StorageLocationDetails {...props} extension={this} />
        ),
      },
    },
    {
      kind: VolumeSnapshotLocation.kind,
      apiVersions: VolumeSnapshotLocation.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<VolumeSnapshotLocation>) => (
          <SnapshotLocationDetails {...props} extension={this} />
        ),
      },
    },
  ];

  // What the activation does is to open the store of the preferences and the way to the main process.
  // Nothing is asked of a cluster, or of the main process, until a view asks.
  protected onActivate(): void {
    PreferencesStore.getInstanceOrCreate<PreferencesStore>().loadExtension(this);
    VeleroIpcRenderer.createInstance(this);
  }
}
