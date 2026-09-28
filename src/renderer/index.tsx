import { Renderer } from "@freelensapp/extensions";
import { PreferencesStore } from "../common/preferences-store";
import { Backup, Restore, Schedule } from "./api/kinds";
import { VeleroIcon } from "./components/velero-icon";
import { BackupDetails } from "./details/backup-details";
import { RestoreDetails } from "./details/restore-details";
import { ScheduleDetails } from "./details/schedule-details";
import {
  BACKUPS_MENU_ID,
  BACKUPS_PAGE_ID,
  RESTORES_MENU_ID,
  RESTORES_PAGE_ID,
  ROOT_MENU_ID,
  SCHEDULES_MENU_ID,
  SCHEDULES_PAGE_ID,
} from "./navigation";
import { BackupsPage } from "./pages/backups-page";
import { RestoresPage } from "./pages/restores-page";
import { SchedulesPage } from "./pages/schedules-page";

export default class VeleroRenderer extends Renderer.LensExtension {
  // Only the views that exist have a page and an entry: nothing here leads to a page that is not there.
  clusterPages = [
    { id: BACKUPS_PAGE_ID, components: { Page: () => <BackupsPage /> } },
    { id: RESTORES_PAGE_ID, components: { Page: () => <RestoresPage /> } },
    { id: SCHEDULES_PAGE_ID, components: { Page: () => <SchedulesPage /> } },
  ];

  // The host gives a page the tabs of its group when the first entry that leads to it is an entry of the
  // group: the entries of the lists come before the one of the group, which leads to the first of them.
  // With the group first, the page it leads to would be the only one without the tabs.
  clusterPageMenus = [
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
    { id: ROOT_MENU_ID, title: "Velero", target: { pageId: BACKUPS_PAGE_ID }, components: { Icon: VeleroIcon } },
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
  ];

  // What the activation does is to open the store of the preferences. Nothing is asked of a cluster.
  protected onActivate(): void {
    PreferencesStore.getInstanceOrCreate<PreferencesStore>().loadExtension(this);
  }
}
