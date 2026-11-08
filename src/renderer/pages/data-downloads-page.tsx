import { DataDownload } from "../api/kinds";
import { FamilyPage } from "../components/family-page";
import { currentInstallation } from "../state/context";
import { OpenView } from "./open-view";
import { volumeOperationList } from "./volume-operation-list";

import type { Installation } from "../state/installation";

export const DATA_DOWNLOADS = volumeOperationList("DataDownload", DataDownload);

// The Data Downloads of the selected installation: the list and, over it, the view of what is open. They are read
// while the page is shown, and only then, under the second version of the group.
export function DataDownloadsPage({ installation = currentInstallation() }: { installation?: Installation }) {
  return <FamilyPage definition={DATA_DOWNLOADS} installation={installation} view={OpenView} />;
}
