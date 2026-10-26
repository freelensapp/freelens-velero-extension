import { PodVolumeBackup } from "../api/kinds";
import { FamilyPage } from "../components/family-page";
import { currentInstallation } from "../state/context";
import { OpenView } from "./open-view";
import { volumeOperationList } from "./volume-operation-list";

import type { Installation } from "../state/installation";

export const POD_VOLUME_BACKUPS = volumeOperationList("PodVolumeBackup", PodVolumeBackup);

// The Pod Volume Backups of the selected installation: the list and, over it, the view of what is open. They are
// read while the page is shown, and only then.
export function PodVolumeBackupsPage({ installation = currentInstallation() }: { installation?: Installation }) {
  return <FamilyPage definition={POD_VOLUME_BACKUPS} installation={installation} view={OpenView} />;
}
