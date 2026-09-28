import { BackupWorkspace } from "./backup-workspace";
import { RestoreWorkspace } from "./restore-workspace";

import type { OpenViewProps } from "../components/family-page";

// The view of one object, of the kind the address names. Every page shows it over its own list: a view
// opened from another one does not leave the list the first was opened from.
export function OpenView({ target, ...props }: OpenViewProps) {
  switch (target.kind) {
    case "restore":
      return <RestoreWorkspace name={target.name} {...props} />;
    default:
      return <BackupWorkspace name={target.name} {...props} />;
  }
}
