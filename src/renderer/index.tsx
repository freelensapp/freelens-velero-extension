import { Renderer } from "@freelensapp/extensions";
import { PreferencesStore } from "../common/preferences-store";
import { Backup } from "./api/kinds";
import { VeleroIcon } from "./components/velero-icon";
import { BackupDetails } from "./details/backup-details";
import { BACKUPS_MENU_ID, BACKUPS_PAGE_ID, ROOT_MENU_ID } from "./navigation";
import { BackupsPage } from "./pages/backups-page";

export default class VeleroRenderer extends Renderer.LensExtension {
  // Only the views that exist have a page and an entry: nothing here leads to a page that is not there.
  clusterPages = [{ id: BACKUPS_PAGE_ID, components: { Page: () => <BackupsPage /> } }];

  clusterPageMenus = [
    { id: ROOT_MENU_ID, title: "Velero", target: { pageId: BACKUPS_PAGE_ID }, components: { Icon: VeleroIcon } },
    {
      id: BACKUPS_MENU_ID,
      parentId: ROOT_MENU_ID,
      title: Backup.crd.title,
      target: { pageId: BACKUPS_PAGE_ID },
      components: {},
    },
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
  ];

  // What the activation does is to open the store of the preferences. Nothing is asked of a cluster.
  protected onActivate(): void {
    PreferencesStore.getInstanceOrCreate<PreferencesStore>().loadExtension(this);
  }
}
