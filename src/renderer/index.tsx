import { Renderer } from "@freelensapp/extensions";
import { PreferencesStore } from "../common/preferences-store";
import { VeleroIpcRenderer } from "./api/ipc";
import { Backup, BackupStorageLocation, Restore, Schedule, VolumeSnapshotLocation } from "./api/kinds";
import { withDetailsErrorBoundary, withPageErrorBoundary } from "./components/error-boundary";
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
import { releaseInstallation } from "./state/context";

export default class VeleroRenderer extends Renderer.LensExtension {
  // Only the views that exist have a page and an entry: nothing here leads to a page that is not there. The
  // host renders a page with its parameters alone: a page that needs the extension is given it here. Every
  // page is drawn inside a boundary, which keeps an error it throws in its place: the field is mapped through
  // it, so a page added to it is too. Its type is given, since the mapping refers to the instance.
  clusterPages: Renderer.LensExtension["clusterPages"] = [
    { id: OVERVIEW_PAGE_ID, components: { Page: () => <OverviewPage extension={this} /> } },
    { id: BACKUPS_PAGE_ID, components: { Page: () => <BackupsPage /> } },
    { id: RESTORES_PAGE_ID, components: { Page: () => <RestoresPage /> } },
    { id: SCHEDULES_PAGE_ID, components: { Page: () => <SchedulesPage /> } },
    { id: STORAGE_LOCATIONS_PAGE_ID, components: { Page: () => <StorageLocationsPage /> } },
    { id: SNAPSHOT_LOCATIONS_PAGE_ID, components: { Page: () => <SnapshotLocationsPage /> } },
  ].map((registration) => withPageErrorBoundary(this, registration));

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

  // The sections of the details of the five kinds, each tied to its kind by `detailsFor`, which takes the
  // kind and the versions from the class and checks the section against it. The host renders a section with
  // the object alone: the extension is given by the registration. The host has no boundary around its drawer
  // of the details: every section is drawn inside one of the extension, which keeps an error in the section
  // and draws it again for another object.
  kubeObjectDetailItems: Renderer.LensExtension["kubeObjectDetailItems"] = [
    Renderer.K8sApi.detailsFor(Backup, {
      priority: 10,
      Details: (props) => <BackupDetails {...props} extension={this} />,
    }),
    Renderer.K8sApi.detailsFor(Restore, {
      priority: 10,
      Details: (props) => <RestoreDetails {...props} extension={this} />,
    }),
    Renderer.K8sApi.detailsFor(Schedule, {
      priority: 10,
      Details: (props) => <ScheduleDetails {...props} extension={this} />,
    }),
    Renderer.K8sApi.detailsFor(BackupStorageLocation, {
      priority: 10,
      Details: (props) => <StorageLocationDetails {...props} extension={this} />,
    }),
    Renderer.K8sApi.detailsFor(VolumeSnapshotLocation, {
      priority: 10,
      Details: (props) => <SnapshotLocationDetails {...props} extension={this} />,
    }),
  ].map((registration) => withDetailsErrorBoundary(this, registration));

  // The kinds with pages of their own in the group of Velero: the Custom Resources tree of the cluster leaves
  // them out while the extension is enabled, and lists them again once it is disabled.
  customResources = [Backup, Restore, Schedule, BackupStorageLocation, VolumeSnapshotLocation];

  // What the activation does is to open the store of the preferences and the way to the main process.
  // Nothing is asked of a cluster, or of the main process, until a view asks. The host runs onDeactivate
  // before it takes the pages out, and a page it draws again in between makes the state of the views again,
  // with no way to the main process: that state is let go here, before the host registers the pages of this
  // activation, so that the first view after an enable makes its own, with the way of this activation.
  protected onActivate(): void {
    releaseInstallation();
    PreferencesStore.getInstanceOrCreate<PreferencesStore>().loadExtension(this);
    VeleroIpcRenderer.createInstance(this);
  }

  // The views let go of what they hold, and the way to the main process is reset: the next activation makes
  // its own, and the views made after it use that one. The host then removes the listener of the instance
  // and resets it again, which finds nothing to reset.
  protected onDeactivate(): void {
    releaseInstallation();
    VeleroIpcRenderer.resetInstance();
  }
}
